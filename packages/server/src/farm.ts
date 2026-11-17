import type { ChaosRun } from "@device-farm/core/chaos/types";
import { appIdFor, type AppConfig } from "@device-farm/core/config/app-config";
import { botFinishAlert, exploreFinishAlert } from "@device-farm/core/slack/finish-alert";
import { DeviceLocks } from "@device-farm/core/device/lock";
import { issueOf, sortIssues } from "@device-farm/core/issues/issue";
import { nightlyBotEpisodes, nightlyBotMinutes, nightlyBotSteps, nightlySeed, type NightlySlot } from "@device-farm/core/nightly/schedule";
import type { DeviceRun } from "@device-farm/core/device/types";
import { probeScreen } from "@device-farm/core/explore/probe";
import { runScreenQa } from "@device-farm/core/qa/run";
import { execFileText, type Exec } from "@device-farm/devices/exec";
import { closeAllIosSessions, getIosSession } from "@device-farm/devices/ios-session";
import { iosMjpegUrl } from "@device-farm/devices/stream/ios";
import { closeUnfinishedChaosRuns } from "@device-farm/engine/chaos/results";
import { designPages, latestDesignResults } from "@device-farm/engine/policy/design-pages";
import { confirmDeviceBaselines, pendingDeviceBaselines } from "@device-farm/engine/check";
import { readLatestExplore, type ExploreResult } from "@device-farm/engine/explore/results";
import { defaultGuard, ExploreRequestError, replayOne, runExplore, type ExploreDeps } from "@device-farm/engine/explore/run";
import { readReady } from "@device-farm/engine/flows/store";
import { closeUnfinishedRun, devicesRoot, listRunSummaries, pruneRuns, readLatestRun, readRun, screenshotOf, writeRun } from "@device-farm/engine/results";
import { readLatestDailyReport } from "@device-farm/engine/report/daily-store";
import { readAlerts } from "@device-farm/engine/slack/alert-store";
import { createRunId, errorMessage, installedVersionLabel, policyScenarioPrefix, runDevices, testResultsRoot, type RunDeps, type RunRequest } from "@device-farm/engine/run";
import { askClaude } from "@device-farm/engine/policy/claude";
import { readAllPageRules, readFigmaCache, readFigmaPageOf, readIgnores } from "@device-farm/engine/policy/rules-store";
import { readFrontFigmaMap } from "@device-farm/engine/policy/front-figma";
import { checkPolicyScreen, policyScreens, withScreenAliases } from "@device-farm/engine/policy/screen-check";
import { readSources } from "@device-farm/engine/policy/store";
import { readScreenMap, recordScreenMap } from "@device-farm/engine/screen-map-store";

import { farmScenarios } from "./scenarios";
import { baselineFor, candidatePng } from "./baselines";
import { createAutoRuns } from "./auto";
import { runBotCheck } from "./bot-check";
import { createCapture } from "./capture";
import { createControlLog } from "./control";
import { startDailyReports } from "./daily-report";
import { createDeviceDeps, createDeviceList } from "./devices";
import { apiOrigin, loadDotEnv, webOrigin } from "./env";
import { loadExploreInputs } from "./explore";
import { createJobGate } from "./jobs";
import { createStreamHub, watchVideo } from "./streams";
import type { Farm, StartResult } from "./types";
import { startPolicyWatch, type PolicyWatch } from "./policy-watch";
import { startSlackAlerts, type SlackAlerts } from "./slack-alerts";
import { startNightlyChecks, type NightlyStart } from "./nightly";
import { startAutoWatch } from "./watch";

export interface FarmOptions {
  /** 점검 대상 앱 설정(`loadAppConfig()`) */
  app: AppConfig;
  exec?: Exec;
  log?: (message: string) => void;
}

export type RunningFarm = Farm & { start: () => Promise<void>; stop: () => Promise<void> };

/** 서버 한 프로세스의 기기·잠금·실행 상태. 잠금은 이 인스턴스 하나만 쓴다. */
export function createFarm(options: FarmOptions): RunningFarm {
  loadDotEnv();
  const { app } = options;
  const scenarios = farmScenarios(app);
  const exec = options.exec ?? execFileText;
  const log = options.log ?? ((message: string) => console.log(`[farm] ${message}`));
  const locks = new DeviceLocks();
  const hub = createStreamHub({ app });
  const deviceDeps = createDeviceDeps(app, exec, hub);
  const devices = createDeviceList(deviceDeps.listDevices, locks);
  const control = createControlLog(locks);
  const capture = createCapture(hub);
  let latest: DeviceRun | null = null;
  /** 지금 도는 수동 점검의 「멈추기」. 끝나면 비운다. */
  let runAbort: AbortController | null = null;
  let exploring: ExploreResult[] | null = null;
  let watch: ReturnType<typeof startAutoWatch> | null = null;
  let policyWatch: PolicyWatch | null = null;
  let nightly: ReturnType<typeof startNightlyChecks> | null = null;
  let dailyReports: ReturnType<typeof startDailyReports> | null = null;
  let slackAlerts: SlackAlerts | null = null;
  /** 슬랙에 넘긴 마지막 실행. 끝난 실행을 한 번만 넘긴다 */
  let alertedRunId: string | null = null;
  /** 실행·기기마다 슬랙에 넘긴 화면 수. 새로 끝난 화면만 넘긴다 */
  const alertedScreens = new Map<string, number>();

  const gate = createJobGate(() => {
    try {
      pruneRuns(devicesRoot, Date.now());
    } catch (error) {
      log(`보관 정리 실패: ${errorMessage(error)}`);
    }
    // 점검 중 쌓인 자동 점검 대기열을 바로 꺼낸다.
    if (watch) void watch.tick();
  });

  /**
   * 버튼 눌러보기: 탐색 점검과 같은 쓰기 허용 목록으로 가드를 건다. 목록 파일이 없으면 가드에서 throw →
   * 그 기기는 버튼을 누르지 않는다(fail closed). dev 웹 주소 기준.
   */
  const buttonCheck = (): RunDeps["buttonCheck"] => {
    let allowlist: ReturnType<typeof loadExploreInputs>["allowlist"] | null = null;
    const loadAllowlist = () => (allowlist ??= loadExploreInputs().allowlist);
    return {
      guard: (driver) => defaultGuard(driver, webOrigin(app, "dev"), loadAllowlist(), (request) => log(`버튼 눌러보기 중 막은 요청: ${request.method} ${request.path}`)),
      probe: (driver, ring, since) => probeScreen(driver, ring, since, loadAllowlist()),
      recordMap: (from, buttons) => recordScreenMap(from, buttons),
    };
  };

  /** 데이터 QA: API 주소가 없으면 돌지 않는다(점검은 그대로). */
  const dataQa = (): Pick<RunDeps, "qaScreens" | "runQa"> => {
    const origin = apiOrigin(app);
    if (!origin || app.qa.screens.length === 0) return {};
    return { qaScreens: app.qa.screens, runQa: (driver, screen) => runScreenQa(driver, screen, { apiOrigin: origin }) };
  };

  /** Claude가 정책 화면을 고를 경로 목록: 시나리오 + 화면 지도에서 본 화면 */
  const knownScreens = () => {
    const edges = readScreenMap().edges;
    return [...new Set([...scenarios.map((scenario) => scenario.path), ...edges.map((edge) => edge.from), ...edges.flatMap((edge) => (edge.to ? [edge.to] : []))])].sort();
  };

  /** 정책·피그마 대조: 뽑힌 규칙이 없으면 돌지 않는다(점검은 그대로). 무시 목록은 점검마다 다시 읽는다 */
  const policyCheck = (): Pick<RunDeps, "policyScreens" | "runPolicy" | "designScreenFor" | "runDesign"> => {
    const rules = readAllPageRules();
    const figmaCache = readFigmaCache();
    const frontRoutes = readFrontFigmaMap()?.routes;
    const pageOf = readFigmaPageOf();
    const ignores = readIgnores();
    // 플로우 「디자인 확인」: 그 경로 하나의 규칙·피그마. 규칙도 피그마도 없으면 null
    const design: Pick<RunDeps, "designScreenFor" | "runDesign"> = {
      designScreenFor: (path) => {
        const screen = policyScreens(rules, [path], figmaCache, frontRoutes, pageOf).find((item) => item.path === path);
        return screen && (screen.rules.length > 0 || screen.figma) ? screen : null;
      },
      runDesign: (driver, screen) => checkPolicyScreen(driver, screen, { ask: askClaude, ignores, stay: true }),
    };
    const screens = withScreenAliases(policyScreens(rules, knownScreens(), figmaCache, frontRoutes, pageOf), readSources().screenAliases);
    if (screens.length === 0) return design;
    return { ...design, policyScreens: screens, runPolicy: (driver, screen) => checkPolicyScreen(driver, screen, { ask: askClaude, ignores }) };
  };

  const runDeps = (): RunDeps => ({
    ...deviceDeps,
    exec,
    locks,
    listDevices: devices.connected,
    scenarios,
    flows: readReady(),
    buttonCheck: buttonCheck(),
    ...dataQa(),
    ...policyCheck(),
    onUpdate: (run) => {
      latest = run;
      writeRun(run);
      // 화면이 끝날 때마다 실패·앱 버그 후보를 바로, 점검이 끝나면 나머지를 슬랙에 알린다(새 것만)
      if (slackAlerts) {
        for (const outcome of run.outcomes) {
          const key = `${run.runId}|${outcome.device.id}`;
          const done = alertedScreens.get(key) ?? 0;
          for (const screen of outcome.screens.slice(done)) {
            slackAlerts.onScreenFinished(run, outcome, screen).catch((error: unknown) => log(`슬랙 알림 실패: ${errorMessage(error)}`));
          }
          alertedScreens.set(key, outcome.screens.length);
        }
      }
      if (run.finishedAt && alertedRunId !== run.runId && slackAlerts) {
        alertedRunId = run.runId;
        slackAlerts.onRunFinished(run).catch((error: unknown) => log(`슬랙 알림 실패: ${errorMessage(error)}`));
      }
    },
    capture,
    baselineFor: (device, scenario, screenshot) => baselineFor(device, scenario, screenshot),
    log,
  });

  const exploreDeps = (): ExploreDeps => ({
    ...loadExploreInputs(),
    app,
    webOrigin: webOrigin(app, "dev"),
    locks,
    listDevices: devices.connected,
    openDriver: deviceDeps.openDriver,
    capture,
    onUpdate: (results) => {
      exploring = results;
    },
    log,
  });

  /** 봇 점검 기기 하나가 끝나면 슬랙에 한 줄 */
  const stopLabels = { run: "기기 점검", bot: "봇 점검", explore: "탐색", policy: "정책 확인" } as const;
  /** 봇 점검·탐색 「중지」. 시작할 때 새로 만들고 끝나면 비운다 */
  let botAbort: AbortController | null = null;
  let exploreAbort: AbortController | null = null;
  /** 봇 점검을 시작한다(야간·수동 같은 길). 바쁘면 null */
  const startBotCheck = (options: { seed: number; minutes: number; episodes: number; stepsPerEpisode: number }) => {
    const abort = new AbortController();
    const started = gate.start("bot", () =>
      runBotCheck(options, { app, exec, locks, connected: devices.connected, log, onFinished: botFinished, signal: abort.signal }).finally(() => {
        if (botAbort === abort) botAbort = null;
      }),
    );
    if (started) botAbort = abort;
    return started;
  };

  const botFinished = async (run: ChaosRun, summary: string | null) => {
    await slackAlerts?.onFinished(botFinishAlert(run, summary));
  };

  function background(kind: string, started: Promise<void>): void {
    started.catch((error: unknown) => log(`${kind} 실패: ${errorMessage(error)}`));
  }

  const auto = createAutoRuns({
    connected: devices.connected,
    gate,
    runDeps,
    record: (run) => {
      writeRun(run);
      latest = run;
    },
    log,
  });

  /** 기기 점검을 시작한다(화면 요청·야간 플로우 점검). 바쁘면 이유를 돌려준다 */
  function startRun(request: Omit<RunRequest, "runId" | "trigger"> & { trigger?: RunRequest["trigger"] }): StartResult {
    const missing = request.flowIds?.filter((id) => !readReady().some((flow) => flow.id === id)) ?? [];
    if (missing.length > 0) return { ok: false, error: `확정 플로우가 아닙니다: ${missing.join(", ")}` };
    if (request.designOnly) {
      const known = new Set((policyCheck().policyScreens ?? []).map((screen) => screen.path));
      if (known.size === 0) return { ok: false, error: "점검할 디자인 화면이 없어요. 정책 규칙이나 피그마가 연결된 화면이 있어야 해요." };
      const unknown = request.designPaths?.filter((path) => !known.has(path)) ?? [];
      if (unknown.length > 0) return { ok: false, error: `디자인 점검 화면이 아닙니다: ${unknown.join(", ")}` };
    }
    const runId = createRunId(Date.now());
    const abort = new AbortController();
    const started = gate.start("run", () => runDevices({ ...request, runId }, { ...runDeps(), signal: abort.signal }));
    if (!started) return { ok: false, error: gate.busyMessage() };
    runAbort = abort;
    background(
      "기기 점검",
      started.finally(() => {
        if (runAbort === abort) runAbort = null;
      }),
    );
    return { ok: true, runId };
  }

  /** 야간 칸 하나를 시작한다(docs/operations.md). 플로우는 기기 점검, 봇은 봇 점검 작업으로 돈다 */
  function startNightly(slot: NightlySlot, scheduledAt: Date): NightlyStart {
    if (slot.kind === "flows") {
      if (readReady().length === 0) return { started: true, note: "확정 플로우가 없어 돌 것이 없음" };
      const started = startRun({ kind: "dev", version: installedVersionLabel, deviceIds: "all", flowsOnly: true, trigger: "auto", label: slot.label });
      return started.ok ? { started: true, note: started.runId } : { started: false, busy: started.error };
    }
    const seed = nightlySeed(scheduledAt);
    const options = { seed, minutes: nightlyBotMinutes, episodes: nightlyBotEpisodes, stepsPerEpisode: nightlyBotSteps };
    const started = startBotCheck(options);
    if (!started) return { started: false, busy: gate.busyMessage() };
    background(slot.label, started);
    return { started: true, note: `시드 ${seed}` };
  }

  async function openIosSessions(): Promise<void> {
    const ios = (await devices.connected()).filter((device) => device.platform === "ios");
    await Promise.all(ios.map((device) => getIosSession(device.id, appIdFor(app, "dev", "ios"), app.ios).catch((error: unknown) => log(`${device.id} Appium 세션을 못 열었습니다: ${errorMessage(error)}`))));
  }

  return {
    app,
    resultsRoot: testResultsRoot,
    locks,
    mjpegUrl: iosMjpegUrl,
    ensureIosSession: async (id) => {
      await getIosSession(id, appIdFor(app, "dev", "ios"), app.ios);
    },
    isBusy: gate.isBusy,
    listDevices: devices.withState,
    platformOf: async (id) => (await devices.withState()).find((device) => device.id === id)?.platform ?? null,
    startRun,
    designPages: () => designPages(policyCheck().policyScreens ?? [], latestDesignResults()),
    stopJob: (kind) => {
      if (kind === "policy") return policyWatch?.cancel() ?? false;
      const abort = kind === "run" ? runAbort : kind === "bot" ? botAbort : exploreAbort;
      if (!abort || abort.signal.aborted) return false;
      abort.abort();
      log(`${stopLabels[kind]} 중지 요청`);
      return true;
    },
    stopRun: () => {
      if (!runAbort || runAbort.signal.aborted) return false;
      runAbort.abort();
      log("점검 멈추기 요청");
      return true;
    },
    // 서버가 안 돌리는 동안엔 DB를 본다 — CLI(policy-check·layout-check)가 쓰는 진행 중 실행도 플로팅·결과에 보이게
    latestRun: () => (gate.isBusy() ? latest : (readLatestRun() ?? latest)),
    pendingBaselines: () => pendingDeviceBaselines(),
    candidatePng: (name) => candidatePng(name),
    confirmBaselines: (names) => confirmDeviceBaselines(names),
    startExplore: (request) => {
      if (gate.isBusy()) return { ok: false, error: gate.busyMessage() };
      const abort = new AbortController();
      const deps = { ...exploreDeps(), signal: abort.signal }; // env·허용 목록이 틀리면 여기서 throw → 시작하지 않는다.
      const runId = createRunId(Date.now());
      const started = gate.start("explore", () =>
        runExplore({ deviceIds: request.deviceIds, runId }, deps)
          .then((results) => slackAlerts?.onFinished(exploreFinishAlert(results)))
          .then(() => undefined)
          .finally(() => {
            exploring = null;
            if (exploreAbort === abort) exploreAbort = null;
          }),
      );
      if (!started) return { ok: false, error: gate.busyMessage() };
      exploreAbort = abort;
      background("탐색", started);
      return { ok: true, runId };
    },
    latestExplore: () => exploring ?? readLatestExplore(),
    replay: async ({ runId, deviceId, pathId }) => {
      let issues: Awaited<ReturnType<typeof replayOne>> = [];
      const deps = exploreDeps();
      const started = gate.start("replay", async () => {
        issues = await replayOne(deviceId, runId, pathId, deps);
      });
      if (!started) throw new ExploreRequestError(409, gate.busyMessage());
      await started;
      return issues;
    },
    sendInput: (id, platform, event) => (platform === "android" ? hub.sendAndroid(id, event) : hub.sendIos(id, event)),
    watchVideo: (id, sink) => watchVideo(hub, id, sink),
    recordControl: control.record,
    runSummaries: () => listRunSummaries(),
    runById: (runId) => readRun(runId),
    issues: () =>
      sortIssues(
        Object.entries(readAlerts()).map(([key, sent]) => {
          const issue = issueOf(key, sent);
          // 정책·피그마 문제는 정책 점검 화면, 점검 실패는 그 시나리오 이름이 화면 기록 키다
          const fromPolicy = issue.items !== undefined || issue.kind === "policy" || issue.kind === "docs" || issue.kind === "unverified";
          const scenario = fromPolicy ? `${policyScenarioPrefix}${issue.items?.[0]?.path ?? issue.path}` : issue.path;
          const screenshot = screenshotOf(issue.runId, scenario);
          return screenshot ? { ...issue, screenshot } : issue;
        }),
      ),
    setIssueStatus: async (key, status) => (slackAlerts ? slackAlerts.setStatus(key, status, "디바이스팜") : false),
    latestDailyReport: () => readLatestDailyReport(),
    startBot: () => {
      const seed = Date.now() % 100_000;
      const options = { seed, minutes: nightlyBotMinutes, episodes: nightlyBotEpisodes, stepsPerEpisode: nightlyBotSteps };
      const started = startBotCheck(options);
      if (!started) return { ok: false, error: gate.busyMessage() };
      background("봇 점검", started);
      return { ok: true, runId: `시드 ${seed}` };
    },
    policyState: () => policyWatch?.state() ?? null,
    checkPolicy: () => policyWatch?.checkNow() ?? false,
    start: async () => {
      if (closeUnfinishedRun()) log("끝나지 않은 실행을 서버 재시작으로 닫았습니다.");
      const closedBots = closeUnfinishedChaosRuns();
      if (closedBots > 0) log(`끝나지 않은 봇 점검 ${closedBots}개를 서버 재시작으로 닫았습니다.`);
      log(`보관 기간이 지난 실행 ${pruneRuns(devicesRoot, Date.now())}개를 지웠습니다.`);
      latest = readLatestRun();
      void openIosSessions().catch((error: unknown) => log(`iOS 세션 준비 실패: ${errorMessage(error)}`));
      watch = startAutoWatch({ isBusy: gate.isBusy, runAuto: auto.runAuto, failIos: auto.failIos, log, install: app.install });
      policyWatch = startPolicyWatch({ app, log, knownScreens });
      slackAlerts = startSlackAlerts(app, log);
      // 야간 점검·아침 분석은 켤 때만(.env FARM_NIGHTLY=1·FARM_DAILY_REPORT=1)
      if (process.env.FARM_NIGHTLY?.trim() === "1") nightly = startNightlyChecks({ start: startNightly, log });
      if (process.env.FARM_DAILY_REPORT?.trim() === "1") dailyReports = startDailyReports({ appName: app.name, log });
    },
    stop: async () => {
      watch?.stop();
      policyWatch?.stop();
      slackAlerts?.stop();
      nightly?.stop();
      dailyReports?.stop();
      control.stop();
      await closeAllIosSessions();
    },
  };
}

import type { ChaosRun } from "@device-farm/core/chaos/types";
import { appIdFor, type AppConfig } from "@device-farm/core/config/app-config";
import { botFinishAlert, exploreFinishAlert } from "@device-farm/core/slack/finish-alert";
import { DeviceLocks } from "@device-farm/core/device/lock";
import { issueOf, sortIssues } from "@device-farm/core/issues/issue";
import { nightlyBotEpisodes, nightlyBotMinutes, nightlyBotSteps, nightlySeed, type NightlySlot } from "@device-farm/core/nightly/schedule";
import type { DeviceRun } from "@device-farm/core/device/types";
import { appSiteOf, probeScreen } from "@device-farm/core/explore/probe";
import { runScreenQa } from "@device-farm/core/qa/run";
import { execFileText, type Exec } from "@device-farm/devices/exec";
import { closeAllIosSessions, getIosSession } from "@device-farm/devices/ios-session";
import { iosMjpegUrl } from "@device-farm/devices/stream/ios";
import { closeUnfinishedChaosRuns } from "@device-farm/engine/chaos/results";
import { designPages, latestDesignResults } from "@device-farm/engine/policy/design-pages";
import { confirmDeviceBaselines, pendingDeviceBaselines } from "@device-farm/engine/check";
import { readLatestExplore, type ExploreResult } from "@device-farm/engine/explore/results";
import { defaultGuard, ExploreRequestError, replayOne, runExplore, type ExploreDeps } from "@device-farm/engine/explore/run";
import { addCandidate, readReady } from "@device-farm/engine/flows/store";
import { missingTargetOf, policyRulesText, qaReportLabel, type ReportResult } from "@device-farm/engine/qa-report/report";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { closeUnfinishedRun, devicesRoot, listRunSummaries, pruneRuns, readLatestRun, readRun, screenshotOf, writeRun } from "@device-farm/engine/results";
import { readLatestDailyReport } from "@device-farm/engine/report/daily-store";
import { readAlerts } from "@device-farm/engine/slack/alert-store";
import type { DeviceScreen } from "@device-farm/core/device/types";
import type { FlowDocument } from "@device-farm/core/flows/schema";
import { screenMapSummary } from "@device-farm/core/device/screen-map";
import { createRunId, errorMessage, flowScenarioPrefix, humanControlMessage, installedVersionLabel, policyScenarioPrefix, runDevices, stoppedMessage, testResultsRoot, type RunDeps, type RunRequest } from "@device-farm/engine/run";
import { askClaude } from "@device-farm/engine/policy/claude";
import { readAllPageRules, readFigmaCache, readFigmaPageOf, readIgnores } from "@device-farm/engine/policy/rules-store";
import { readFrontFigmaMap } from "@device-farm/engine/policy/front-figma";
import { checkPolicyScreen, policyScreens, withScreenAliases } from "@device-farm/engine/policy/screen-check";
import { diffFigmaCopy, figmaChecks } from "@device-farm/core/policy/compare";
import { readSources } from "@device-farm/engine/policy/store";
import { readScreenMap, recordScreenMap } from "@device-farm/engine/screen-map-store";

import { recheckSummary } from "./recheck";
import { farmScenarios, isUncheckedPath } from "./scenarios";
import { baselineFor, candidatePng } from "./baselines";
import { createAutoRuns } from "./auto";
import { runBotCheck } from "./bot-check";
import { createCapture } from "./capture";
import { createControlLog } from "./control";
import { startDailyReports } from "./daily-report";
import { createDeviceDeps, createDeviceList } from "./devices";
import { apiOrigin, loadDotEnv, webOrigin } from "./env";
import { webHealth } from "./web-health";
import { loadExploreInputs } from "./explore";
import { createJobQueue, replayBusyMessage, type EnqueueInput, type JobEnd, type JobSource } from "./queue/job-queue";
import { startIdleNetworkWatch } from "@device-farm/engine/network/idle-watch";
import { openAndroidDriver, relaunchApp } from "@device-farm/devices/android-driver";
import { createStreamHub, watchVideo } from "./streams";
import type { Farm, StartResult } from "./types";
import { startPolicyWatch, type PolicyWatch } from "./policy-watch";
import { startSlackAlerts, type SlackAlerts } from "./slack-alerts";
import { startNightlyChecks, type NightlyStart } from "./nightly";
import { startAutoWatch } from "./watch";


/** 제보 점검이 「직접 조작 중」으로 건너뛰어지면 기다렸다 다시 서는 횟수·간격 (작성자 판단) */
const reportBusyAttempts = 3;
const reportBusyWaitMs = 60_000;
/** 제보 프롬프트에 넣는 팝업: 최근 점검 수·줄 수 (작성자 판단) */
const recentPopupRuns = 20;
const maxKnownPopups = 30;
const popupScenarioPrefix = "팝업 · ";
/** 제보 답에 붙이는 피그마 어긋남 줄 수 (작성자 판단) */
const maxDesignLines = 8;
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
  let networkWatch: ReturnType<typeof startIdleNetworkWatch> | null = null;
  let slackAlerts: SlackAlerts | null = null;
  /** 슬랙에 넘긴 마지막 실행. 끝난 실행을 한 번만 넘긴다 */
  let alertedRunId: string | null = null;
  /** 시작 알림을 보낸 점검 */
  const startedRunIds = new Set<string>();
  /** QA 제보에 밀려 멈춘 점검. 끝 알림 대신 「멈춤」을 보낸다 */
  const pausedRunIds = new Set<string>();
  /** 실행·기기마다 슬랙에 넘긴 화면 수. 새로 끝난 화면만 넘긴다 */
  const alertedScreens = new Map<string, number>();

  /** 점검·탐색·봇 점검 대기열(queue/specs). 작업 하나가 끝날 때마다 보관 기간을 정리한다 */
  const queue = createJobQueue({
    onJobEnd: () => {
      try {
        pruneRuns(devicesRoot, Date.now());
      } catch (error) {
        log(`보관 정리 실패: ${errorMessage(error)}`);
      }
    },
    log,
  });

  /**
   * 버튼 눌러보기: 탐색 점검과 같은 쓰기 허용 목록으로 가드를 건다. 목록 파일이 없으면 가드에서 throw →
   * 그 기기는 버튼을 누르지 않는다(fail closed). dev 웹 주소 기준.
   */
  const buttonCheck = (): RunDeps["buttonCheck"] => {
    let allowlist: ReturnType<typeof loadExploreInputs>["allowlist"] | null = null;
    const loadAllowlist = () => (allowlist ??= loadExploreInputs().allowlist);
    return {
      guard: (driver, onBlocked) =>
        defaultGuard(driver, webOrigin(app, "dev"), loadAllowlist(), (request) => {
          onBlocked(request);
          log(`버튼 눌러보기 중 막은 요청: ${request.method} ${request.path}`);
        }),
      // 바깥 요청(광고·CDN·분석) 실패는 버튼 탓이 아니다. 앱 웹과 같은 사이트·API 호스트만 본다
      probe: (driver, ring, since) => probeScreen(driver, ring, since, loadAllowlist(), appSiteOf(webOrigin(app, "dev"))),
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
    const paths = [...scenarios.map((scenario) => scenario.path), ...edges.map((edge) => edge.from), ...edges.flatMap((edge) => (edge.to ? [edge.to] : []))];
    // 화면 지도에서 본 개발용·접은 서비스 화면은 정책 점검에도 넣지 않는다
    return [...new Set(paths.filter((item) => !isUncheckedPath(item, app.uncheckedPathPrefixes)))].sort();
  };

  /** 정책·피그마 대조: 뽑힌 규칙이 없으면 돌지 않는다(점검은 그대로). 무시 목록은 점검마다 다시 읽는다 */
  const policyCheck = (): Pick<RunDeps, "policyScreens" | "runPolicy" | "designScreenFor" | "runDesign" | "checkPopupDesign"> => {
    const rules = readAllPageRules();
    const figmaCache = readFigmaCache();
    const frontRoutes = readFrontFigmaMap()?.routes;
    const pageOf = readFigmaPageOf();
    const ignores = readIgnores();
    // 플로우 「디자인 확인」: 그 경로 하나의 규칙·피그마. 규칙도 피그마도 없으면 null
    const design: Pick<RunDeps, "designScreenFor" | "runDesign" | "checkPopupDesign"> = {
      designScreenFor: (path) => {
        const screen = policyScreens(rules, [path], figmaCache, frontRoutes, pageOf).find((item) => item.path === path);
        return screen && (screen.rules.length > 0 || screen.figma) ? screen : null;
      },
      runDesign: (driver, screen) => checkPolicyScreen(driver, screen, { ask: askClaude, ignores, stay: true }),
      // 팝업 문구가 그 화면 피그마 페이지에 있나. 페이지 문구가 없으면 노드 문구와. 피그마가 없으면 대조하지 않는다
      checkPopupDesign: (path, popupText) => {
        const screen = policyScreens(rules, [path], figmaCache, frontRoutes, pageOf).find((item) => item.path === path);
        const figma = screen?.figmaPage ?? screen?.figma;
        if (!figma) return [];
        return figmaChecks(diffFigmaCopy(figma.texts, popupText), figma.hash, path, ignores);
      },
    };
    const screens = withScreenAliases(
      policyScreens(rules, knownScreens(), figmaCache, frontRoutes, pageOf),
      // 개발용 테스트 경로(`/dev/farm-sample` 등)는 별칭이 있어도 점검하지 않는다
      Object.fromEntries(Object.entries(readSources().screenAliases ?? {}).filter(([alias]) => !isUncheckedPath(alias, app.uncheckedPathPrefixes))),
    );
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
    serverHealth: (kind) => webHealth(app, kind),
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
      if (!run.finishedAt && !startedRunIds.has(run.runId) && slackAlerts) {
        startedRunIds.add(run.runId);
        slackAlerts.onRunStarted(run).catch((error: unknown) => log(`슬랙 알림 실패: ${errorMessage(error)}`));
      }
      if (run.finishedAt && alertedRunId !== run.runId && slackAlerts) {
        alertedRunId = run.runId;
        slackAlerts.onRunFinished(run, { paused: pausedRunIds.delete(run.runId) }).catch((error: unknown) => log(`슬랙 알림 실패: ${errorMessage(error)}`));
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
  /** 봇 점검을 대기열에 넣는다(야간·수동 같은 길) */
  type BotOptions = { seed: number; minutes: number; episodes: number; stepsPerEpisode: number };
  /** 봇 점검 한 칸. 급한 작업에 밀리면 멈추고 같은 시드로 처음부터 다시 선다(봇은 이어 갈 항목이 없다) */
  const botInput = (options: BotOptions, source: JobSource, label: string): EnqueueInput => ({
    kind: "bot",
    label: `${label} · 시드 ${options.seed}`,
    source,
    ref: `시드 ${options.seed}`,
    work: () => {
      const abort = new AbortController();
      botAbort = abort;
      return runBotCheck(options, { app, exec, locks, connected: devices.connected, log, onFinished: botFinished, signal: abort.signal }).finally(() => {
        if (botAbort === abort) botAbort = null;
      });
    },
    interrupt: () => {
      const abort = botAbort;
      if (!abort || abort.signal.aborted) return null;
      abort.abort();
      return botInput(options, source, `${label.replace(/ \(다시\)$/, "")} (다시)`);
    },
  });
  /** 봇 점검을 대기열에 넣는다(야간·수동 같은 길) */
  const startBotCheck = (options: BotOptions, source: JobSource, label = "봇 점검") => queue.enqueue(botInput(options, source, label));

  const botFinished = async (run: ChaosRun, summary: string | null) => {
    await slackAlerts?.onFinished(botFinishAlert(run, summary));
  };

  const auto = createAutoRuns({
    connected: devices.connected,
    queue,
    runDeps,
    record: (run) => {
      writeRun(run);
      latest = run;
    },
    log,
  });

  /** 점검 대기열·플로팅에 보일 이름 */
  function runLabel(request: Omit<RunRequest, "runId">): string {
    if (request.label) return request.label;
    if (request.designOnly) return "디자인 점검";
    if (request.flowsOnly) return request.flowIds ? `플로우 점검 · ${request.flowIds.length}개` : "플로우 점검";
    return `기기 점검 · ${request.kind} ${request.version}`;
  }

  /** 기기 점검을 대기열에 넣는다(화면 요청·야간 플로우 점검). 요청이 틀렸거나 대기열이 꽉 차면 이유를 돌려준다 */
  function startRun(request: Omit<RunRequest, "runId" | "trigger"> & { trigger?: RunRequest["trigger"] }, source: JobSource = "manual"): StartResult {
    const queued = queueRun(request, source);
    return queued.ok ? { ok: true, runId: queued.runId, position: queued.position } : queued;
  }

  /** 「멈춰」: 돌고 있는 작업이 QA 제보 점검일 때만 멈춘다(기기 점검은 건드리지 않는다) */
  function stopReport(): void {
    if (queue.state().running?.label !== qaReportLabel || !runAbort || runAbort.signal.aborted) return;
    runAbort.abort();
    log("QA 제보 점검 멈춤(스레드 「멈춰」)");
  }

  /** 정책서 규칙을 `test-results/qa-reports/policy/policy-rules.md`로 쓰고 그 폴더(제보마다 새로) */
  function writeQaPolicyRules(): string | null {
    try {
      const dir = path.resolve("test-results/qa-reports/policy");
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, "policy-rules.md"), policyRulesText(readAllPageRules()));
      return dir;
    } catch (error) {
      log(`QA 제보 정책서 규칙 쓰기 실패: ${errorMessage(error)}`);
      return null;
    }
  }

  /** QA 제보로 만든 플로우를 확정 없이 한 번 돌리고 끝나면 결과 */
  async function runReportFlow(flow: FlowDocument): Promise<ReportResult> {
    for (let attempt = 1; ; attempt += 1) {
      const queued = queueRun({ kind: "dev", version: installedVersionLabel, deviceIds: "all", flowsOnly: true, flowIds: [flow.id], adhocFlows: [flow], keepScreenshot: true, label: qaReportLabel }, "manual", { urgent: true });
      if (!queued.ok) throw new Error(queued.error);
      await queued.done;
      const outcomes = readRun(queued.runId)?.outcomes ?? [];
      const screens = outcomes.flatMap((outcome) => outcome.screens.filter((screen) => screen.scenario.startsWith(flowScenarioPrefix)));
      // 누가 디바이스팜 화면에서 기기를 직접 조작 중이면 건너뛰어진다. 제보 점검은 잠깐 기다렸다 다시 선다
      const busy = screens.length === 0 && outcomes.length > 0 && outcomes.every((outcome) => outcome.message === humanControlMessage);
      if (busy && attempt < reportBusyAttempts) {
        log(`QA 제보 점검: 기기를 직접 조작 중이라 ${reportBusyWaitMs / 1000}초 뒤 다시 돌려요(${attempt}/${reportBusyAttempts})`);
        await new Promise((resolve) => setTimeout(resolve, reportBusyWaitMs));
        continue;
      }
      const summary = recheckSummary(screens);
      const status = summary.passed ? "passed" : screens.some((screen) => screen.status === "failed") ? "failed" : "unsure";
      // 디자인 확인(design) 스텝의 피그마 대조. 어긋나도 플로우는 통과라, 결과 문구에 따로 붙인다
      const design = outcomes.flatMap((outcome) => outcome.screens.filter((screen) => screen.scenario.startsWith(policyScenarioPrefix)));
      const designNote = designSummary(design);
      const skipped = [...new Set(outcomes.flatMap((outcome) => (outcome.message ? [`${outcome.device.model ?? outcome.device.id}: ${outcome.message}`] : [])))];
      const note = [screens.length === 0 && skipped.length > 0 ? `돌린 플로우가 없어요. ${skipped.join(" · ")}` : summary.note, designNote].filter(Boolean).join("\n");
      const shot = screens.find((screen) => screen.screenshot)?.screenshot;
      const missing = missingTargetOf(screens);
      return { status, note, runId: queued.runId, ...(missing ? { missing } : {}), ...(shot ? { screenshot: `${devicesRoot}/../${shot}` } : {}) };
    }
  }

  /**
   * 디자인 확인 스텝의 정책·피그마 대조 결과 한 줄씩(제보 답에 붙인다). 어긋난 것만 최대 8개씩.
   * 정책 규칙은 Confluence 정책서에서 뽑은 것, 피그마는 프론트 코드가 단 노드의 피그마 페이지다.
   */
  function designSummary(design: readonly DeviceScreen[]): string {
    const lines: string[] = [];
    for (const screen of design) {
      const path = screen.scenario.slice(policyScenarioPrefix.length);
      const checks = screen.checks ?? [];
      const figma = checks.filter((check) => check.id.startsWith("figma:"));
      const policy = checks.filter((check) => !check.id.startsWith("figma:") && check.id !== "open" && !check.id.startsWith("layout-"));
      const listOff = (off: typeof checks) => off.slice(0, maxDesignLines).map((check) => `  · ${check.title} — ${check.message ?? ""}`);
      const policyOff = policy.filter((check) => !check.ok);
      lines.push(policy.length === 0 ? `정책 대조 ${path}: 연결된 정책 규칙 없음` : `정책 대조 ${path}: 규칙 ${policy.length}개 중 어긋남 ${policyOff.length}개`, ...listOff(policyOff));
      const figmaOff = figma.filter((check) => !check.ok);
      lines.push(figmaOff.length === 0 ? `피그마 대조 ${path}: 어긋남 없음` : `피그마 대조 ${path}: 어긋남 ${figmaOff.length}개`, ...listOff(figmaOff));
    }
    return lines.join("\n");
  }

  /** 최근 점검에서 기기에 뜬 팝업: `경로 · 제목 · 버튼: …` (제보 플로우를 만들 때 배너 버튼 이름을 알려 준다) */
  function knownPopups(): string[] {
    const seen = new Map<string, string>();
    for (const summary of listRunSummaries(recentPopupRuns)) {
      for (const outcome of readRun(summary.runId)?.outcomes ?? []) {
        for (const screen of outcome.screens) {
          if (!screen.scenario.startsWith(popupScenarioPrefix) || seen.has(screen.scenario)) continue;
          const shown = screen.checks?.find((check) => check.id === "popup-shown")?.message;
          if (shown) seen.set(screen.scenario, `${screen.scenario.slice(popupScenarioPrefix.length)} · ${shown}`);
        }
      }
    }
    return [...seen.values()].slice(0, maxKnownPopups);
  }

  type QueuedRun = { ok: true; runId: string; position: number; done: Promise<JobEnd> } | { ok: false; error: string };
  type RunInputRequest = Omit<RunRequest, "runId" | "trigger"> & { trigger?: RunRequest["trigger"] };
  function queueRun(request: RunInputRequest, source: JobSource, options: { urgent?: boolean } = {}): QueuedRun {
    const missing = request.flowIds?.filter((id) => !readReady().some((flow) => flow.id === id) && !request.adhocFlows?.some((flow) => flow.id === id)) ?? [];
    if (missing.length > 0) return { ok: false, error: `확정 플로우가 아닙니다: ${missing.join(", ")}` };
    if (request.designOnly) {
      const known = new Set((policyCheck().policyScreens ?? []).map((screen) => screen.path));
      if (known.size === 0) return { ok: false, error: "점검할 디자인 화면이 없어요. 정책 규칙이나 피그마가 연결된 화면이 있어야 해요." };
      const unknown = request.designPaths?.filter((path) => !known.has(path)) ?? [];
      if (unknown.length > 0) return { ok: false, error: `디자인 점검 화면이 아닙니다: ${unknown.join(", ")}` };
    }
    // 넣을 때 id를 만든다: CLI는 이 id의 실행이 latest가 될 때까지 기다린다
    const runId = createRunId(Date.now());
    const queued = queue.enqueue(runInput(request, runId, source, () => [], options.urgent === true));
    if (!queued.ok) return queued;
    return { ok: true, runId, position: queued.position, done: queued.done };
  }

  /**
   * 기기 점검 한 칸. 급한 작업(QA 제보)이 들어오면 지금 항목까지 하고 멈춘 뒤,
   * 결과가 이미 있는 항목은 건너뛰고 설치 없이 「(이어서)」로 다시 선다.
   * `skip`은 시작할 때 읽는다: 멈춘 점검이 결과를 다 쓴 뒤여야 한다.
   */
  function runInput(request: RunInputRequest, runId: string, source: JobSource, skip: () => readonly string[], urgent: boolean): EnqueueInput {
    const label = runLabel(request);
    return {
      kind: "run",
      label,
      source,
      ref: runId,
      urgent,
      work: () => {
        const abort = new AbortController();
        runAbort = abort;
        const skipNames = skip();
        const resumed = skipNames.length > 0 ? { skipNames, skipInstall: true } : {};
        return runDevices({ ...request, ...resumed, runId }, { ...runDeps(), signal: abort.signal }).finally(() => {
          if (runAbort === abort) runAbort = null;
        });
      },
      interrupt: () => {
        const abort = runAbort;
        if (!abort || abort.signal.aborted) return null;
        pausedRunIds.add(runId);
        abort.abort();
        const before = skip();
        const base = label.replace(/ \(이어서\)$/, "");
        return runInput({ ...request, label: `${base} (이어서)` }, createRunId(Date.now()), source, () => [...before, ...doneNames(runId)], false);
      },
    };
  }

  /** 멈춘 점검에서 결과가 남은 항목 이름(멈춤 표시는 빼고) */
  const doneNames = (runId: string): string[] =>
    (readRun(runId)?.outcomes ?? []).flatMap((outcome) => outcome.screens.filter((screen) => screen.message !== stoppedMessage).map((screen) => screen.scenario));

  /** 대기 순서를 붙인 야간 기록 메모 */
  const queuedNote = (note: string, position: number) => (position > 0 ? `${note} · 대기 ${position}번째` : note);

  /** 예약 칸 하나를 시작한다(docs/operations.md). 정기 점검은 전체 기기 점검(버튼 눌러보기 없이), 봇은 봇 점검 작업으로 돈다 */
  function startNightly(slot: NightlySlot, scheduledAt: Date): NightlyStart {
    if (slot.kind === "regular") {
      // 앞 정기 점검이 아직 돌거나 기다리면 쌓지 않는다. 창 안에서 끝나면 그때 돈다
      const { running, pending } = queue.state();
      if ([running, ...pending].some((job) => job?.label === slot.label)) return { started: false, busy: "앞 정기 점검이 아직 끝나지 않았습니다." };
      const started = startRun({ kind: "dev", version: installedVersionLabel, deviceIds: "all", skipInstall: true, trigger: "auto", label: slot.label }, "nightly");
      return started.ok ? { started: true, note: queuedNote(started.runId, started.position) } : { started: false, busy: started.error };
    }
    const seed = nightlySeed(scheduledAt);
    const options = { seed, minutes: nightlyBotMinutes, episodes: nightlyBotEpisodes, stepsPerEpisode: nightlyBotSteps };
    const started = startBotCheck(options, "nightly", slot.label);
    if (!started.ok) return { started: false, busy: started.error };
    return { started: true, note: queuedNote(`시드 ${seed}`, started.position) };
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
    isBusy: queue.isBusy,
    jobQueue: () => queue.state(),
    cancelQueued: (id) => queue.cancel(id),
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
    latestRun: () => (queue.isBusy() ? latest : (readLatestRun() ?? latest)),
    pendingBaselines: () => pendingDeviceBaselines(),
    candidatePng: (name) => candidatePng(name),
    confirmBaselines: (names) => confirmDeviceBaselines(names),
    startExplore: (request) => {
      exploreDeps(); // env·허용 목록이 틀리면 여기서 throw → 대기열에 넣지 않는다.
      const runId = createRunId(Date.now());
      const queued = queue.enqueue({
        kind: "explore",
        label: "탐색",
        source: "manual",
        ref: runId,
        work: () => {
          const abort = new AbortController();
          exploreAbort = abort;
          return runExplore({ deviceIds: request.deviceIds, runId }, { ...exploreDeps(), signal: abort.signal })
            .then((results) => slackAlerts?.onFinished(exploreFinishAlert(results)))
            .finally(() => {
              exploring = null;
              if (exploreAbort === abort) exploreAbort = null;
            });
        },
      });
      if (!queued.ok) return queued;
      return { ok: true, runId, position: queued.position };
    },
    latestExplore: () => exploring ?? readLatestExplore(),
    replay: async ({ runId, deviceId, pathId }) => {
      let issues: Awaited<ReturnType<typeof replayOne>> = [];
      const deps = exploreDeps();
      const started = queue.startNow(async () => {
        issues = await replayOne(deviceId, runId, pathId, deps);
      });
      if (!started) throw new ExploreRequestError(409, replayBusyMessage);
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
      const started = startBotCheck(options, "manual");
      if (!started.ok) return started;
      return { ok: true, runId: `시드 ${seed}`, position: started.position };
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
      // 자동 점검도 대기열에 줄을 선다. 감시기가 따로 빈자리를 기다리지 않는다
      watch = startAutoWatch({ isBusy: () => false, runAuto: auto.runAuto, failIos: auto.failIos, log, install: app.install });
      policyWatch = startPolicyWatch({ app, log, knownScreens });
      slackAlerts = startSlackAlerts(app, log, { screenMap: () => screenMapSummary(readScreenMap().edges), qaReport: { saveCandidate: (flow) => addCandidate(flow), runFlow: runReportFlow, knownFlows: () => readReady(), knownPopups, stopReport, policyDir: writeQaPolicyRules } });
      // 예약 점검·아침 분석은 켤 때만(.env FARM_NIGHTLY=1·FARM_DAILY_REPORT=1)
      if (process.env.FARM_NIGHTLY?.trim() === "1") nightly = startNightlyChecks({ start: startNightly, log });
      if (process.env.FARM_DAILY_REPORT?.trim() === "1") dailyReports = startDailyReports({ appName: app.name, log });
      // 쉬는 Android 기기가 「웹페이지를 사용할 수 없음」에 멈춰 있으면 고친다
      const watchOwner = { kind: "bot", runId: "network-watch" } as const;
      networkWatch = startIdleNetworkWatch({
        busy: queue.isBusy,
        idleDevices: async () => {
          const idle = (await devices.withState()).filter((device) => device.platform === "android" && device.state === "idle");
          const running = await Promise.all(idle.map(async (device) => (await exec("adb", ["-s", device.id, "shell", "pidof", appIdFor(app, "dev", "android")]).catch(() => "")).trim() !== ""));
          return idle.filter((_, index) => running[index]).map((device) => device.id);
        },
        reload: async (id) => {
          if (!locks.acquire(id, watchOwner)) return null;
          try {
            const driver = await openAndroidDriver(id, appIdFor(app, "dev", "android"), webOrigin(app, "dev"), app, exec);
            try {
              const network = (await driver.recoverNetwork?.()) ?? { status: "none" };
              if (network.status !== "none") return network;
              // 점검 중 502가 났다 끝난 뒤에도 화면이 502로 남는다. 서버가 살아났으면 앱을 다시 켜게 failed로 돌려준다.
              // 서버가 아직 죽어 있으면 그대로 둔다(다시 켜도 같은 화면이라 다음 바퀴에 본다)
              const gateway = await driver.gatewayError?.();
              if (!gateway || (await webHealth(app, "dev"))) return network;
              return { status: "failed", code: gateway };
            } finally {
              await driver.close().catch(() => undefined);
            }
          } finally {
            locks.release(id, watchOwner);
          }
        },
        relaunch: (id) => relaunchApp(exec, id, appIdFor(app, "dev", "android"), app.android.mainActivity),
        log,
      });
    },
    stop: async () => {
      watch?.stop();
      policyWatch?.stop();
      slackAlerts?.stop();
      nightly?.stop();
      dailyReports?.stop();
      networkWatch?.stop();
      control.stop();
      await closeAllIosSessions();
    },
  };
}

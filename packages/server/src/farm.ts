import { DeviceLocks } from "@device-farm/core/device/lock";
import { appIdFor, type AppConfig } from "@device-farm/core/config/app-config";
import type { DeviceRun } from "@device-farm/core/device/types";
import { probeScreen } from "@device-farm/core/explore/probe";
import { runScreenQa } from "@device-farm/core/qa/run";
import { execFileText, type Exec } from "@device-farm/devices/exec";
import { closeAllIosSessions, getIosSession } from "@device-farm/devices/ios-session";
import { iosMjpegUrl } from "@device-farm/devices/stream/ios";
import { confirmDeviceBaselines, pendingDeviceBaselines } from "@device-farm/engine/check";
import { readLatestExplore, type ExploreResult } from "@device-farm/engine/explore/results";
import { defaultGuard, ExploreRequestError, replayOne, runExplore, type ExploreDeps } from "@device-farm/engine/explore/run";
import { readReady } from "@device-farm/engine/flows/store";
import { closeUnfinishedRun, devicesRoot, pruneRuns, readLatestRun, writeRun } from "@device-farm/engine/results";
import { createRunId, errorMessage, runDevices, testResultsRoot, type RunDeps } from "@device-farm/engine/run";
import { askClaude } from "@device-farm/engine/policy/claude";
import { readAllPageRules, readFigmaCache, readIgnores } from "@device-farm/engine/policy/rules-store";
import { readFrontFigmaMap } from "@device-farm/engine/policy/front-figma";
import { checkPolicyScreen, policyScreens } from "@device-farm/engine/policy/screen-check";
import { readScreenMap, recordScreenMap } from "@device-farm/engine/screen-map-store";

import { farmScenarios } from "./scenarios";
import { baselineFor, candidatePng } from "./baselines";
import { createAutoRuns } from "./auto";
import { createCapture } from "./capture";
import { createControlLog } from "./control";
import { createDeviceDeps, createDeviceList } from "./devices";
import { apiOrigin, loadDotEnv, webOrigin } from "./env";
import { loadExploreInputs } from "./explore";
import { createJobGate } from "./jobs";
import { createStreamHub, watchVideo } from "./streams";
import type { Farm } from "./types";
import { startPolicyWatch, type PolicyWatch } from "./policy-watch";
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
  const policyCheck = (): Pick<RunDeps, "policyScreens" | "runPolicy"> => {
    const screens = policyScreens(readAllPageRules(), knownScreens(), readFigmaCache(), readFrontFigmaMap()?.routes);
    if (screens.length === 0) return {};
    const ignores = readIgnores();
    return { policyScreens: screens, runPolicy: (driver, screen) => checkPolicyScreen(driver, screen, { ask: askClaude, ignores }) };
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
    startRun: (request) => {
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
    },
    stopRun: () => {
      if (!runAbort || runAbort.signal.aborted) return false;
      runAbort.abort();
      log("점검 멈추기 요청");
      return true;
    },
    latestRun: () => latest,
    pendingBaselines: () => pendingDeviceBaselines(),
    candidatePng: (name) => candidatePng(name),
    confirmBaselines: (names) => confirmDeviceBaselines(names),
    startExplore: (request) => {
      if (gate.isBusy()) return { ok: false, error: gate.busyMessage() };
      const deps = exploreDeps(); // env·허용 목록이 틀리면 여기서 throw → 시작하지 않는다.
      const runId = createRunId(Date.now());
      const started = gate.start("explore", () => runExplore({ deviceIds: request.deviceIds, runId }, deps).finally(() => {
        exploring = null;
      }));
      if (!started) return { ok: false, error: gate.busyMessage() };
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
    policyState: () => policyWatch?.state() ?? null,
    checkPolicy: () => policyWatch?.checkNow() ?? false,
    start: async () => {
      if (closeUnfinishedRun(devicesRoot)) log("끝나지 않은 실행을 서버 재시작으로 닫았습니다.");
      log(`보관 기간이 지난 실행 ${pruneRuns(devicesRoot, Date.now())}개를 지웠습니다.`);
      latest = readLatestRun(devicesRoot);
      void openIosSessions().catch((error: unknown) => log(`iOS 세션 준비 실패: ${errorMessage(error)}`));
      watch = startAutoWatch({ isBusy: gate.isBusy, runAuto: auto.runAuto, failIos: auto.failIos, log, install: app.install });
      policyWatch = startPolicyWatch({ app, log, knownScreens });
    },
    stop: async () => {
      watch?.stop();
      policyWatch?.stop();
      control.stop();
      await closeAllIosSessions();
    },
  };
}

import { randomBytes } from "node:crypto";
import path from "node:path";

import { checkButtons as defaultCheckButtons, summarizeButtons, type ButtonResult } from "@device-farm/core/device/button-check";
import type { ScreenDriver } from "@device-farm/core/device/driver";
import type { DeviceLocks, LockOwner } from "@device-farm/core/device/lock";
import { waitForScreen } from "@device-farm/core/device/screen-ready";
import {
  deviceConcurrency,
  type BuildKind,
  type Device,
  type DeviceOutcome,
  type DeviceRun,
  type DeviceScreen,
  type FlowStepView,
  type OutcomePhase,
  type OutcomeStatus,
  type Platform,
  type RunTrigger,
} from "@device-farm/core/device/types";
import type { Issue } from "@device-farm/core/explore/probe";
import { runFlow as defaultRunFlow, withHome, type FlowResult } from "@device-farm/core/flows/run";
import { stepLabels, stepTarget, type FlowDocument } from "@device-farm/core/flows/schema";
import { LogRing } from "@device-farm/core/logs/ring";
import type { QaScreen } from "@device-farm/core/qa/rules";
import type { QaReport } from "@device-farm/core/qa/run";
import { hasBugCandidate } from "@device-farm/core/policy/compare";
import type { ScreenScenario } from "@device-farm/core/scenarios";
import type { Exec } from "@device-farm/devices/exec";
import { appIdFor, type AppConfig } from "@device-farm/core/config/app-config";
import { installAndLaunch as defaultInstallAndLaunch, type InstallResult } from "@device-farm/devices/install";
import { installSourceOf } from "@device-farm/devices/install-source";

import { checkScreen as defaultCheckScreen, type ScreenCheck } from "./check";
import type { PolicyScreen, PolicyScreenReport } from "./policy/screen-check";
import { writeFailureBundle, type BundleFrame, type FailureBundleInput } from "./results";

export const humanControlMessage = "직접 조작 중이라 건너뜀";
export const stoppedMessage = "점검을 멈췄습니다.";
/** 실패 묶음 경로의 기준. DeviceScreen.screenshot·logDir는 이 아래 상대 경로다(`/api/devices/files`). */
export const testResultsRoot = path.resolve("test-results");

const offlinePattern = /device not found|disconnected|offline/i;

export interface RunRequest {
  kind: BuildKind;
  version: string;
  deviceIds: readonly string[] | "all";
  trigger?: RunTrigger;
  /** HTTP가 202로 먼저 돌려줄 때 미리 만든 id. 없으면 새로 만든다. */
  runId?: string;
  /** true면 설치·화면 점검 없이 지금 깔린 앱으로 확정 플로우만 돈다. */
  flowsOnly?: boolean;
  /** true면 화면마다 보이는 버튼을 눌러 반응·에러를 본다(`button-check.ts`). */
  buttonCheck?: boolean;
}

/** 버튼 눌러보기 준비물. 가드는 쓰기 요청을 막고(탐색 점검과 같은 허용 목록), probe는 누른 뒤 문제를 모은다. */
export interface ButtonCheckSetup {
  guard: (driver: ScreenDriver) => Promise<() => Promise<void>>;
  probe: (driver: ScreenDriver, ring: LogRing, since: number) => Promise<Issue[]>;
  checkButtons?: typeof defaultCheckButtons;
  /** 한 화면의 버튼 결과를 화면 지도에 합친다(`screen-map.ts`). 없으면(테스트) 남기지 않는다. */
  recordMap?: (from: string, buttons: readonly ButtonResult[]) => void;
}

export const installedVersionLabel = "설치된 앱";

/** 기기 하나의 로그·영상 링버퍼. 화면이 실패하면 실패 묶음에 들어간다. */
export interface DeviceCapture {
  ring: LogRing;
  frames: () => BundleFrame[];
  stop: () => Promise<void>;
}

export type BaselineImages = { baseline: Buffer; diff: Buffer };

export interface RunDeps {
  /** 점검 대상 앱 설정 */
  app: AppConfig;
  exec: Exec;
  locks: DeviceLocks;
  listDevices: () => Promise<Device[]>;
  fetchBuild: (input: { platform: Platform; kind: BuildKind; version: string }) => Promise<string>;
  openDriver: (device: Device, appId: string) => Promise<ScreenDriver>;
  scenarios: readonly ScreenScenario[];
  /** 확정(ready) 플로우. 화면 시나리오 뒤에 이어서 돈다. */
  flows?: readonly FlowDocument[];
  runFlow?: (driver: ScreenDriver, flow: FlowDocument, onStep: (index: number) => void) => Promise<FlowResult>;
  buttonCheck?: ButtonCheckSetup;
  /** 데이터 QA 화면. 플로우 뒤에 이어서 돈다(`core/qa`). runQa가 없으면 돌지 않는다. */
  qaScreens?: readonly QaScreen[];
  runQa?: (driver: ScreenDriver, screen: QaScreen) => Promise<QaReport>;
  /** 정책·피그마 대조 화면(docs/design-policy-figma.md). 데이터 QA 뒤에 이어서 돈다. runPolicy가 없으면 돌지 않는다. */
  policyScreens?: readonly PolicyScreen[];
  runPolicy?: (driver: ScreenDriver, screen: PolicyScreen) => Promise<PolicyScreenReport>;
  onUpdate: (run: DeviceRun) => void;
  installAndLaunch?: (device: Device, file: string, appId: string, exec: Exec) => Promise<InstallResult>;
  /** 설치 방식이 testflight인 기기(iOS dev). 설치된 버전이 맞을 때까지 기다린 뒤 앱을 연다. */
  waitForTestflight?: (device: Device, kind: BuildKind, version: string) => Promise<InstallResult>;
  checkScreen?: (driver: ScreenDriver, device: Device, scenario: ScreenScenario) => Promise<ScreenCheck>;
  now?: () => number;
  /** 있으면 실패 화면마다 실패 묶음을 쓴다. 없으면(테스트·CLI) run.json만 남는다. */
  capture?: (device: Device, driver: ScreenDriver, appId: string) => Promise<DeviceCapture>;
  /** 기준 비교로 실패했을 때 기준·차이 PNG. 없으면 undefined. */
  baselineFor?: (device: Device, scenario: ScreenScenario, screenshot: Buffer) => BaselineImages | undefined;
  writeBundle?: (dir: string, input: FailureBundleInput) => Promise<void>;
  resultsRoot?: string;
  log?: (message: string) => void;
  /**
   * 「점검 멈추기」. 화면·플로우 하나가 끝날 때마다 보고 남은 것은 돌지 않는다.
   * ponytail: 도는 중인 화면·플로우·설치 대기(TestFlight 최대 30분)는 끝까지 간다. 즉시 끊어야 하면 각 단계에 signal을 넘긴다.
   */
  signal?: AbortSignal;
}

interface DeviceJob {
  device: Device;
  outcome: DeviceOutcome;
  request: RunRequest;
  run: DeviceRun;
  deps: RunDeps;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isOffline(error: unknown): boolean {
  return offlinePattern.test(errorMessage(error));
}

export function createRunId(now: number): string {
  const stamp = new Date(now).toISOString().replace(/[-:.]/g, "").replace("Z", "");
  return `${stamp}-${randomBytes(2).toString("hex")}`;
}

function settle(job: DeviceJob, status: OutcomeStatus, message?: string): void {
  delete job.outcome.phase;
  delete job.outcome.current;
  delete job.outcome.flowSteps;
  job.outcome.status = status;
  if (message === undefined) delete job.outcome.message;
  else job.outcome.message = message;
  job.deps.onUpdate(job.run);
}

/** 화면 결과로 기기 outcome. `failed`가 `login_required`보다 먼저다(제품 실패를 덮지 않는다). */
function isStopped(job: DeviceJob): boolean {
  return job.deps.signal?.aborted === true;
}

/** 멈춘 기기: 이미 실패한 화면이 있으면 failed, 아니면 건너뜀 */
function stoppedOutcome(outcome: DeviceOutcome): OutcomeStatus {
  return outcome.screens.some((screen) => screen.status === "failed") ? "failed" : "skipped";
}

function screensOutcome(outcome: DeviceOutcome): OutcomeStatus {
  if (outcome.screens.some((screen) => screen.status === "failed")) return "failed";
  if (outcome.screens.some((screen) => screen.status === "login_required")) return "login_required";
  return "passed";
}

/** 파일·디렉터리 이름 한 칸. 경로 구분자와 앞 점을 지운다. */
export function pathSegment(name: string): string {
  return name.replace(/[\\/]/g, "_").replace(/^\.+/, "_");
}

function logOf(deps: RunDeps): (message: string) => void {
  return deps.log ?? ((message) => console.warn(`[run] ${message}`));
}

async function failureScreenshot(job: DeviceJob, driver: ScreenDriver, result: ScreenCheck): Promise<Buffer | null> {
  if (result.screenshot) return result.screenshot;
  try {
    return await driver.screenshot();
  } catch (error) {
    logOf(job.deps)(`${job.device.id} 실패 화면 스크린샷을 못 찍었습니다: ${errorMessage(error)}`);
    return null;
  }
}

function baselineImages(job: DeviceJob, scenario: ScreenScenario, screenshot: Buffer): BaselineImages | undefined {
  try {
    return job.deps.baselineFor?.(job.device, scenario, screenshot);
  } catch (error) {
    logOf(job.deps)(`${scenario.name} 기준·차이 이미지를 못 만들었습니다: ${errorMessage(error)}`);
    return undefined;
  }
}

type BundlePaths = Pick<DeviceScreen, "screenshot" | "logDir">;

/**
 * 실패 화면 하나의 묶음. 경로는 `test-results` 기준 상대 경로.
 * ponytail: 실패 즉시 쓴다. 그래서 logs는 실패 뒤 30초를 기다리지 않고 그때까지의 것만 담긴다.
 */
async function bundleFailure(job: DeviceJob, driver: ScreenDriver, capture: DeviceCapture, name: string, result: ScreenCheck, scenario?: ScreenScenario): Promise<BundlePaths> {
  const screenshot = await failureScreenshot(job, driver, result);
  if (!screenshot) return {};
  const root = job.deps.resultsRoot ?? testResultsRoot;
  const dir = path.join(root, "devices", job.run.runId, pathSegment(job.device.id), pathSegment(name));
  const relative = path.relative(root, dir).split(path.sep).join("/");
  const input: FailureBundleInput = {
    logs: capture.ring.around((job.deps.now ?? Date.now)()),
    frames: capture.frames(),
    screenshot,
    // checkScreen이 스크린샷을 돌려준 실패 = 기준 비교 실패. 앱 오류·예외는 기준·차이를 붙이지 않는다.
    baseline: result.screenshot && scenario ? baselineImages(job, scenario, screenshot) : undefined,
  };
  try {
    await (job.deps.writeBundle ?? writeFailureBundle)(dir, input);
  } catch (error) {
    // writeFailureBundle은 영상 전에 나머지를 먼저 쓴다. 영상(ffmpeg) 실패는 묶음을 버리지 않는다.
    logOf(job.deps)(`${relative} 실패 묶음 일부를 못 썼습니다: ${errorMessage(error)}`);
  }
  return { screenshot: `${relative}/screenshot.png`, logDir: relative };
}

async function checkOne(job: DeviceJob, driver: ScreenDriver, scenario: ScreenScenario): Promise<ScreenCheck> {
  const check = job.deps.checkScreen ?? defaultCheckScreen;
  try {
    return await check(driver, job.device, scenario);
  } catch (error) {
    if (isOffline(error)) throw error;
    return { status: "failed", message: errorMessage(error) };
  }
}

/** 정상으로 열린 화면에서만 버튼을 누른다. 에러가 난 버튼이 있으면 그 화면을 실패로 바꾼다. */
async function pressButtons(job: DeviceJob, driver: ScreenDriver, capture: DeviceCapture | null, scenario: ScreenScenario, result: ScreenCheck): Promise<{ result: ScreenCheck; buttons?: ButtonResult[] }> {
  const setup = job.deps.buttonCheck;
  if (!job.request.buttonCheck || !setup || (result.status !== "passed" && result.status !== "candidate")) return { result };
  job.outcome.current = `${scenario.name} · 버튼 눌러보기`;
  job.deps.onUpdate(job.run);
  const ring = capture?.ring ?? new LogRing();
  const buttons = await (setup.checkButtons ?? defaultCheckButtons)(driver, {
    probe: (since) => setup.probe(driver, ring, since),
    screenPath: scenario.path,
    restore: async () => {
      // 딥링크로 다시 열기만 하면 앱이 WebView 스택을 계속 쌓아 메모리 부족으로 죽을 수 있다. 스택을 먼저 닫는다.
      await driver.goHome?.();
      await driver.navigate(scenario.path);
      await waitForScreen(driver, scenario.path);
    },
  });
  try {
    setup.recordMap?.(scenario.path, buttons);
  } catch (error) {
    // 지도는 부가 기록이다. 못 써도 점검 결과는 바꾸지 않는다.
    logOf(job.deps)(`화면 지도 기록 실패: ${errorMessage(error)}`);
  }
  const summary = summarizeButtons(buttons);
  const message = result.message ? `${result.message} · ${summary}` : summary;
  if (buttons.some((button) => button.status === "error")) return { result: { status: "failed", message }, buttons };
  return { result: { ...result, message }, buttons };
}

/** 시나리오를 목록 순서로. login_required가 나오면 멈춘다. 연결 끊김은 throw로 올린다. */
async function runScenarios(job: DeviceJob, driver: ScreenDriver, capture: DeviceCapture | null): Promise<void> {
  for (const scenario of job.request.flowsOnly ? [] : job.deps.scenarios) {
    if (isStopped(job)) return;
    job.outcome.phase = "checking";
    job.outcome.current = scenario.name;
    job.deps.onUpdate(job.run);
    const { result, buttons } = await pressButtons(job, driver, capture, scenario, await checkOne(job, driver, scenario));
    const bundle = result.status === "failed" && capture ? await bundleFailure(job, driver, capture, scenario.name, result, scenario) : {};
    job.outcome.screens.push({ scenario: scenario.name, status: result.status, message: result.message, buttons, ...bundle });
    job.deps.onUpdate(job.run);
    if (result.status === "login_required") return;
  }
  await runFlows(job, driver, capture);
  await runQaScreens(job, driver, capture);
  await runPolicyScreens(job, driver, capture);
}

export const flowScenarioPrefix = "플로우 · ";
export const qaScenarioPrefix = "데이터 · ";
export const policyScenarioPrefix = "정책 · ";

const qaScreensOf = (deps: RunDeps) => (deps.runQa ? (deps.qaScreens ?? []) : []);

async function qaOne(runQa: NonNullable<RunDeps["runQa"]>, driver: ScreenDriver, screen: QaScreen): Promise<QaReport> {
  try {
    return await runQa(driver, screen);
  } catch (error) {
    if (isOffline(error)) throw error;
    return { path: screen.path, name: screen.name, apis: [], checks: [{ id: "run", title: "데이터 QA 실행", ok: false, message: errorMessage(error) }] };
  }
}

/** 데이터 QA 화면을 순서대로. 규칙이 하나라도 실패하면 그 화면은 실패이고, 첫 실패 사유를 메시지로 남긴다. */
async function runQaScreens(job: DeviceJob, driver: ScreenDriver, capture: DeviceCapture | null): Promise<void> {
  const { runQa } = job.deps;
  if (!runQa) return;
  for (const screen of qaScreensOf(job.deps)) {
    if (isStopped(job)) return;
    const name = `${qaScenarioPrefix}${screen.name}`;
    job.outcome.phase = "checking";
    job.outcome.current = name;
    job.deps.onUpdate(job.run);
    const report = await qaOne(runQa, driver, screen);
    const failed = report.checks.filter((check) => !check.ok);
    const message = failed.length > 0 ? `${failed.length}개 실패 · ${failed[0].title}: ${failed[0].message ?? ""}` : undefined;
    const status = failed.length > 0 ? "failed" : "passed";
    const bundle = status === "failed" && capture ? await bundleFailure(job, driver, capture, name, { status: "failed", message }) : {};
    job.outcome.screens.push({ scenario: name, status, message, checks: report.checks, ...bundle });
    job.deps.onUpdate(job.run);
  }
}

/** 어긋남 요약: 무시하지 않은 어긋남 수와 첫 사유 */
function policyMessage(report: PolicyScreenReport): string | undefined {
  // 분류가 붙은 정책 어긋남만 센다. 피그마 문구 차이(분류 없음)는 결과 목록에만 둔다
  const open = report.checks.filter((check) => !check.ok && !check.ignored && check.finding);
  const notes = [
    open.length > 0 ? `어긋남 ${open.length}개 · ${open[0].title}: ${open[0].message ?? ""}` : null,
    report.situational > 0 ? `상황 필요 규칙 ${report.situational}개는 확인 안 함` : null,
    report.judgeError ?? null,
  ].filter(Boolean);
  return notes.length > 0 ? notes.join(" · ") : undefined;
}

/** 정책 대조 화면을 순서대로. 어긋남은 실패가 아니고, 무시하지 않은 "버그 후보"가 있을 때만 그 화면을 실패로 둔다 */
async function runPolicyScreens(job: DeviceJob, driver: ScreenDriver, capture: DeviceCapture | null): Promise<void> {
  const { runPolicy } = job.deps;
  if (!runPolicy) return;
  for (const screen of job.deps.policyScreens ?? []) {
    if (isStopped(job)) return;
    const name = `${policyScenarioPrefix}${screen.path}`;
    job.outcome.phase = "checking";
    job.outcome.current = name;
    job.deps.onUpdate(job.run);
    let report: PolicyScreenReport;
    try {
      report = await runPolicy(driver, screen);
    } catch (error) {
      if (isOffline(error)) throw error;
      report = { path: screen.path, checks: [], situational: 0, cached: false, judgeError: errorMessage(error) };
    }
    const status = hasBugCandidate(report.checks) ? "failed" : "passed";
    const message = policyMessage(report);
    const bundle = status === "failed" && capture ? await bundleFailure(job, driver, capture, name, { status: "failed", message }) : {};
    job.outcome.screens.push({ scenario: name, status, message, checks: report.checks, ...bundle });
    job.deps.onUpdate(job.run);
  }
}

/** 스텝 index를 시작했을 때의 진행 패널 목록 */
function flowStepViews(flow: FlowDocument, running: number): FlowStepView[] {
  return withHome(flow).map((step, index) => ({
    label: `${stepLabels[step.type]} 「${stepTarget(step)}」`,
    status: index < running ? "passed" : index === running ? "running" : "pending",
  }));
}

async function flowOne(job: DeviceJob, driver: ScreenDriver, flow: FlowDocument): Promise<FlowResult> {
  const onStep = (index: number) => {
    job.outcome.flowSteps = flowStepViews(flow, index);
    job.deps.onUpdate(job.run);
  };
  try {
    return await (job.deps.runFlow ?? ((target, item, step) => defaultRunFlow(target, item, { onStep: step })))(driver, flow, onStep);
  } catch (error) {
    if (isOffline(error)) throw error;
    return { status: "failed", steps: [], message: errorMessage(error) };
  }
}

/** 확정 플로우를 순서대로. 결과는 화면 결과와 같은 목록에 `플로우 · 이름`으로 남는다. */
async function runFlows(job: DeviceJob, driver: ScreenDriver, capture: DeviceCapture | null): Promise<void> {
  for (const flow of job.deps.flows ?? []) {
    if (isStopped(job)) return;
    const name = `${flowScenarioPrefix}${flow.name}`;
    job.outcome.phase = "checking";
    job.outcome.current = name;
    job.deps.onUpdate(job.run);
    const result = await flowOne(job, driver, flow);
    delete job.outcome.flowSteps;
    const bundle = result.status === "failed" && capture ? await bundleFailure(job, driver, capture, name, { status: "failed" }) : {};
    job.outcome.screens.push({ scenario: name, status: result.status, message: result.message, steps: result.steps, ...bundle });
    job.deps.onUpdate(job.run);
  }
}

function emptyCapture(): DeviceCapture {
  return { ring: new LogRing(), frames: () => [], stop: async () => undefined };
}

/** 수집기를 못 띄워도 점검은 돈다. 묶음에는 스크린샷만 남는다. */
async function startCapture(job: DeviceJob, driver: ScreenDriver, appId: string): Promise<DeviceCapture | null> {
  if (!job.deps.capture) return null;
  try {
    return await job.deps.capture(job.device, driver, appId);
  } catch (error) {
    logOf(job.deps)(`${job.device.id} 로그 수집을 못 띄웠습니다: ${errorMessage(error)}`);
    return emptyCapture();
  }
}

async function stopCapture(job: DeviceJob, capture: DeviceCapture | null): Promise<void> {
  try {
    await capture?.stop();
  } catch (error) {
    logOf(job.deps)(`${job.device.id} 로그 수집 정지 실패: ${errorMessage(error)}`);
  }
}

export const testflightUnsupportedMessage = "TestFlight 설치를 기다릴 방법이 없습니다.";

async function installBuild(job: DeviceJob): Promise<InstallResult> {
  const { device, request, deps } = job;
  try {
    if (installSourceOf(deps.app.install, device.platform, request.kind) === "testflight") {
      if (!deps.waitForTestflight) return { ok: false, message: testflightUnsupportedMessage };
      return await deps.waitForTestflight(device, request.kind, request.version);
    }
    const file = await deps.fetchBuild({ platform: device.platform, kind: request.kind, version: request.version });
    return await (deps.installAndLaunch ?? defaultInstallAndLaunch)(device, file, appIdFor(deps.app, request.kind, device.platform), deps.exec);
  } catch (error) {
    return { ok: false, message: errorMessage(error) };
  }
}

function markPhase(job: DeviceJob, phase: OutcomePhase): void {
  job.outcome.phase = phase;
  delete job.outcome.current;
  job.deps.onUpdate(job.run);
}

/**
 * 버튼 눌러보기 전 쓰기 요청 가드를 건다. 가드를 못 걸면(iOS 등) 버튼은 누르지 않는다(fail closed).
 * 그 기기는 버튼 눌러보기를 끄고 이유를 기기 메시지로 남긴다.
 */
async function guardButtons(job: DeviceJob, driver: ScreenDriver): Promise<(() => Promise<void>) | null> {
  if (!job.request.buttonCheck || !job.deps.buttonCheck) return null;
  try {
    return await job.deps.buttonCheck.guard(driver);
  } catch (error) {
    job.request = { ...job.request, buttonCheck: false };
    job.outcome.message = `버튼 눌러보기를 건너뜀: ${errorMessage(error)}`;
    return null;
  }
}

async function testDevice(job: DeviceJob): Promise<void> {
  if (isStopped(job)) {
    settle(job, "skipped", stoppedMessage);
    return;
  }
  if (!job.request.flowsOnly) {
    const source = installSourceOf(job.deps.app.install, job.device.platform, job.request.kind);
    markPhase(job, source === "testflight" ? "waiting_testflight" : "installing");
    const installed = await installBuild(job);
    if (!installed.ok) {
      settle(job, "install_failed", installed.message);
      return;
    }
    if (isStopped(job)) {
      settle(job, "skipped", stoppedMessage);
      return;
    }
  }
  const appId = appIdFor(job.deps.app, job.request.kind, job.device.platform);
  const driver = await job.deps.openDriver(job.device, appId);
  const capture = await startCapture(job, driver, appId);
  const unguard = await guardButtons(job, driver);
  try {
    await runScenarios(job, driver, capture);
  } finally {
    await unguard?.().catch((error: unknown) => logOf(job.deps)(`${job.device.id} 버튼 가드 해제 실패: ${errorMessage(error)}`));
    // 통과한 기기의 링버퍼·프레임은 여기서 버려진다. 남는 것은 run.json뿐이다.
    await stopCapture(job, capture);
    // 연결이 끊긴 뒤의 close 실패는 이미 offline으로 남으므로 결과를 바꾸지 않는다.
    await driver.close().catch(() => undefined);
  }
  if (isStopped(job)) {
    settle(job, stoppedOutcome(job.outcome), stoppedMessage);
    return;
  }
  // 버튼 눌러보기를 건너뛴 이유 같은 기기 메시지는 남긴다.
  settle(job, screensOutcome(job.outcome), job.outcome.message);
}

async function runDevice(job: DeviceJob): Promise<void> {
  const owner: LockOwner = { kind: "bot", runId: job.run.runId };
  if (!job.deps.locks.acquire(job.device.id, owner)) {
    settle(job, "skipped", humanControlMessage);
    return;
  }
  try {
    await testDevice(job);
  } catch (error) {
    // 드라이버 열기 실패 중 연결 끊김이 아닌 것은 기기 failed로 남긴다(작성자 판단).
    settle(job, isOffline(error) ? "offline" : "failed", errorMessage(error));
  } finally {
    job.deps.locks.release(job.device.id, owner);
  }
}

/** 단순 작업자 풀. work는 throw하지 않는다고 가정한다(runDevice가 다 잡는다). */
export async function eachLimited<T>(items: readonly T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      await work(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

export function pickDevices(devices: readonly Device[], deviceIds: RunRequest["deviceIds"]): Device[] {
  if (deviceIds === "all") return [...devices];
  return devices.filter((device) => deviceIds.includes(device.id));
}

/** 버전을 받아 기기마다 설치하고 화면 시나리오를 돌린다. 진행 상태는 onUpdate로 매번 내보낸다. */
export async function runDevices(request: RunRequest, deps: RunDeps): Promise<DeviceRun> {
  const now = deps.now ?? Date.now;
  const startedAt = now();
  const devices = pickDevices(await deps.listDevices(), request.deviceIds);
  const run: DeviceRun = {
    runId: request.runId ?? createRunId(startedAt),
    kind: request.kind,
    version: request.version,
    trigger: request.trigger ?? "manual",
    scenarioCount: (request.flowsOnly ? 0 : deps.scenarios.length) + (deps.flows?.length ?? 0) + qaScreensOf(deps).length,
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: null,
    outcomes: devices.map((device) => ({ device, status: "running", screens: [] })),
  };
  deps.onUpdate(run);
  const jobs = run.outcomes.map((outcome) => ({ device: outcome.device, outcome, request, run, deps }));
  await eachLimited(jobs, deviceConcurrency, runDevice);
  run.finishedAt = new Date(now()).toISOString();
  deps.onUpdate(run);
  return run;
}

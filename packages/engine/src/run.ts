import { skipIgnoredFailures } from "@device-farm/core/slack/failure-alert";
import { stoppedText } from "@device-farm/core/slack/finish-alert";
import type { PolicyIgnore } from "@device-farm/core/policy/compare";
import { readIgnores } from "./policy/rules-store";
import { randomBytes } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";

import { diffMessage } from "@device-farm/core/baseline/diff";
import { checkButtons as defaultCheckButtons, summarizeButtons, type ButtonResult } from "@device-farm/core/device/button-check";
import { isLoginPath, type ScreenDriver } from "@device-farm/core/device/driver";
import { blockedByFarmMessage, isHarmlessBlocked, isInfraFailure } from "@device-farm/core/device/infra-error";
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
import type { BlockedRequest } from "@device-farm/core/explore/guard";
import type { Issue } from "@device-farm/core/explore/probe";
import { sleep } from "@device-farm/core/sleep";
import { normalizePath, samePath } from "@device-farm/core/device/screen-ready";
import { runFlow as defaultRunFlow, withHome, type FlowResult } from "@device-farm/core/flows/run";
import { stepLabels, stepTarget, type FlowDocument } from "@device-farm/core/flows/schema";
import { layoutMessage } from "@device-farm/core/layout/layout";
import { LogRing } from "@device-farm/core/logs/ring";
import type { QaCheck, QaScreen } from "@device-farm/core/qa/rules";
import type { QaReport } from "@device-farm/core/qa/run";
import { hasBugCandidate, type PolicyCheck } from "@device-farm/core/policy/compare";
import { popupCloseLabel, popupScenarioPrefix, untitledPopup } from "@device-farm/core/device/popup";
import type { ScreenScenario } from "@device-farm/core/scenarios";
import type { Exec } from "@device-farm/devices/exec";
import { appIdFor, type AppConfig } from "@device-farm/core/config/app-config";
import { installAndLaunch as defaultInstallAndLaunch, type InstallResult } from "@device-farm/devices/install";
import { installSourceOf } from "@device-farm/devices/install-source";

import { checkScreen as defaultCheckScreen, type ScreenCheck } from "./check";
import { checkLayout as defaultCheckLayout } from "./layout/check";
import type { PolicyScreen, PolicyScreenReport } from "./policy/screen-check";
import { withNetworkRecovery } from "./network/guard";
import { withPopupGuard, type PopupEvent } from "./popups/guard";
import { writeFailureBundle, type BundleFrame, type FailureBundleInput } from "./results";
import { classify, homeSkipMessage, homeStreakLimit, infraStreakLimit, isHomeStartFailure, isServerDown, maxRetriesPerDevice, serverDownPrefix, serverNotReadyMessage, serverStartPollMs, serverStartWaitMs, serverStreakLimit, settleRetry, shouldRetry, type Attempt } from "./retry";

export const humanControlMessage = "직접 조작 중이라 건너뜀";
export const stoppedMessage = stoppedText;
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
  /** true면 설치·화면·데이터·정책 점검 없이 지금 깔린 앱으로 확정 플로우만 돈다. */
  flowsOnly?: boolean;
  /** 있으면 이 확정 플로우만 돈다(플로우 점검 탭에서 하나씩 실행). flowsOnly와 함께 쓴다 */
  flowIds?: readonly string[];
  /** true면 설치·화면·플로우·데이터 점검 없이 지금 깔린 앱으로 디자인(정책·피그마) 화면만 본다(「디자인 점검」 탭). */
  designOnly?: boolean;
  /** 있으면 이 경로의 디자인 화면만. designOnly와 함께 쓴다 */
  designPaths?: readonly string[];
  /** 이어서 돌릴 때 이미 결과가 있는 항목 이름(화면·플로우·데이터·정책). 건너뛴다(QA 제보에 밀려 멈춘 점검 이어가기) */
  skipNames?: readonly string[];
  /** true면 설치하지 않는다(이어서 돌릴 때 이미 같은 빌드가 깔려 있다) */
  skipInstall?: boolean;
  /** true면 통과한 플로우도 마지막 화면(스크린샷·로그·영상)을 남긴다(QA 제보 답에 완료 화면을 붙인다) */
  keepScreenshot?: boolean;
  /** 확정 전 플로우를 이번 점검에만 더한다(QA 제보로 만든 플로우). flowIds에 그 id를 넣어 함께 쓴다 */
  adhocFlows?: readonly FlowDocument[];
  /** 있으면 설치·플로우·데이터·정책 점검 없이 지금 깔린 앱으로 이 이름의 화면 시나리오만 다시 본다(실패한 화면만 다시 확인) */
  scenarioNames?: readonly string[];
  /** 점검 이름(「야간 플로우 점검」). 실행 기록과 진행 중 플로팅 제목에 쓴다 */
  label?: string;
  /** true면 화면마다 보이는 버튼을 눌러 반응·에러를 본다(`button-check.ts`). */
  buttonCheck?: boolean;
}

/** 버튼 눌러보기 준비물. 가드는 쓰기 요청을 막고(탐색 점검과 같은 허용 목록), probe는 누른 뒤 문제를 모은다. */
export interface ButtonCheckSetup {
  /** onBlocked: 막은 요청마다 부른다 */
  guard: (driver: ScreenDriver, onBlocked: (request: BlockedRequest) => void) => Promise<() => Promise<void>>;
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
  /** 화면 깨짐 점검(테스트 주입용). 없으면 열린 화면 DOM을 잰다 */
  checkLayout?: (driver: ScreenDriver, screenPath: string, log: (message: string) => void) => Promise<QaCheck[]>;
  locks: DeviceLocks;
  listDevices: () => Promise<Device[]>;
  fetchBuild: (input: { platform: Platform; kind: BuildKind; version: string }) => Promise<string>;
  openDriver: (device: Device, appId: string) => Promise<ScreenDriver>;
  scenarios: readonly ScreenScenario[];
  /** 확정(ready) 플로우. 화면 시나리오 뒤에 이어서 돈다. */
  flows?: readonly FlowDocument[];
  runFlow?: (driver: ScreenDriver, flow: FlowDocument, onStep: (index: number) => void) => Promise<FlowResult>;
  /** 플로우 하나의 최대 시간. 없으면 flowTimeoutMs (테스트용) */
  flowTimeoutMs?: number;
  buttonCheck?: ButtonCheckSetup;
  /** 데이터 QA 화면. 플로우 뒤에 이어서 돈다(`core/qa`). runQa가 없으면 돌지 않는다. */
  qaScreens?: readonly QaScreen[];
  runQa?: (driver: ScreenDriver, screen: QaScreen) => Promise<QaReport>;
  /** 정책·피그마 대조 화면(docs/design-policy-figma.md). 데이터 QA 뒤에 이어서 돈다. runPolicy가 없으면 돌지 않는다. */
  policyScreens?: readonly PolicyScreen[];
  runPolicy?: (driver: ScreenDriver, screen: PolicyScreen) => Promise<PolicyScreenReport>;
  /**
   * 플로우 「디자인 확인」 스텝: 경로의 규칙·피그마를 찾고(없으면 null) 화면을 다시 열지 않고 대조한다.
   * 둘 다 있어야 돈다. 없으면 화면 깨짐만 잰다.
   */
  designScreenFor?: (path: string) => PolicyScreen | null;
  runDesign?: (driver: ScreenDriver, screen: PolicyScreen) => Promise<PolicyScreenReport>;
  /** 팝업 문구를 그 경로의 피그마와 대조한 결과(popups/specs). 없으면 대조하지 않는다 */
  checkPopupDesign?: (path: string, popupText: string) => PolicyCheck[];
  onUpdate: (run: DeviceRun) => void;
  installAndLaunch?: (device: Device, file: string, appId: string, exec: Exec) => Promise<InstallResult>;
  /** 설치 방식이 testflight인 기기(iOS dev). 설치된 버전이 맞을 때까지 기다린 뒤 앱을 연다. */
  waitForTestflight?: (device: Device, kind: BuildKind, version: string) => Promise<InstallResult>;
  checkScreen?: (driver: ScreenDriver, device: Device, scenario: ScreenScenario) => Promise<ScreenCheck>;
  /** 무시 목록(「문제 아님」). 기본은 policy/ignored.json */
  readIgnores?: () => readonly PolicyIgnore[];
  now?: () => number;
  /** 있으면 실패 화면마다 실패 묶음을 쓴다. 없으면(테스트·CLI) 실행 기록만 남는다. */
  capture?: (device: Device, driver: ScreenDriver, appId: string) => Promise<DeviceCapture>;
  /** 기준 비교로 실패했을 때 기준·차이 PNG. 없으면 undefined. */
  baselineFor?: (device: Device, scenario: ScreenScenario, screenshot: Buffer) => BaselineImages | undefined;
  writeBundle?: (dir: string, input: FailureBundleInput) => Promise<void>;
  resultsRoot?: string;
  log?: (message: string) => void;
  /**
   * 앱 웹 서버가 정상 응답하는지. 정상이면 null, 아니면 이유(「HTTP 502」·「응답 없음」).
   * 점검을 시작할 때와 플로우가 실패했을 때 본다. 없으면 보지 않는다.
   */
  serverHealth?: (kind: BuildKind) => Promise<string | null>;
  /** 시작할 때 서버를 기다리는 시간. 없으면 serverStartWaitMs (테스트용) */
  serverStartWaitMs?: number;
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
  /** 배치를 이미 잰 화면 경로. 화면 점검·정책 점검이 같은 화면을 열어도 한 번만 잰다 */
  layoutChecked?: Set<string>;
  /** 이미 결과에 남긴 팝업(`경로|제목`). 열 때마다 뜨는 팝업을 한 번만 남긴다 */
  popupsSeen?: Set<string>;
  /** 이 기기에서 다시 돌린 횟수. maxRetriesPerDevice까지  */
  retries?: number;
  /** 화면 점검·플로우에서 점검 못 함이 연속 확정된 수 */
  infraStreak?: number;
  /** 플로우가 「홈에서 시작」에서 연속 실패한 수 */
  homeStreak?: number;
  /** 마지막 실패 때 dev 서버 확인 결과(정상이면 null) */
  homeServer?: string | null;
  /** 서버 탓 점검 못 함이 이어진 수 */
  serverStreak?: number;
  /** 버튼을 이미 눌러 본 화면 경로 */
  pressedPaths?: Set<string>;
  /** 버튼 가드가 막은 요청. 플로우 중에는 없어야 한다 */
  blocked?: BlockedRequest[];
  /** 버튼 가드를 못 풀었다. 플로우 전에 드라이버를 새로 연다 */
  guardLeft?: boolean;
}

/** 드라이버·로그 수집·가드 묶음. 기기·연결 실패 뒤 다시 돌릴 때 통째로 새로 연다 */
interface DriverSession {
  driver: ScreenDriver;
  capture: DeviceCapture | null;
  reopen(): Promise<void>;
  close(): Promise<void>;
}

/** 만난 팝업을 `팝업 · <제목>` 결과로 남긴다. 닫지 못했으면 실패. 피그마 차이는 정책 점검처럼 결과만 남기고 실패로 치지 않는다 */
async function recordPopup(job: DeviceJob, driver: ScreenDriver, capture: DeviceCapture | null, event: PopupEvent): Promise<void> {
  const path = normalizePath(event.path);
  const title = event.info.title || untitledPopup;
  const key = `${path}|${title}`;
  job.popupsSeen ??= new Set();
  if (event.closedBy && job.popupsSeen.has(key)) return;
  job.popupsSeen.add(key);
  const name = `${popupScenarioPrefix}${title}`;
  const closed = event.closedBy !== null;
  const buttons = event.info.buttons.map((button) => button.name).join(" · ") || "없음";
  const checks: QaCheck[] = [
    { id: "popup-shown", title: "팝업이 떴다", ok: true, message: `${path} · 문구: ${event.info.texts.slice(0, 6).join(" / ")} · 버튼: ${buttons}` },
    { id: "popup-closed", title: "사람처럼 닫을 수 있다", ok: closed, message: popupCloseLabel(event.closedBy) },
  ];
  let design: PolicyCheck[] = [];
  try {
    design = job.deps.checkPopupDesign?.(path, event.info.texts.join("\n")) ?? [];
  } catch (error) {
    logOf(job.deps)(`${name} 피그마 대조 실패: ${errorMessage(error)}`);
  }
  const status = closed ? "passed" : "failed";
  const message = closed ? `${path}에서 뜸 · ${popupCloseLabel(event.closedBy)}` : `${path}에서 뜬 팝업을 닫지 못해 뒤 화면을 누를 수 없습니다.`;
  // 팝업은 닫으면 다시 못 찍는다. 닫기 전에 찍은 화면으로 묶음을 쓴다(통과여도 남긴다)
  const bundle = capture && event.screenshot ? await bundleFailure(job, driver, capture, name, { status: "failed", screenshot: event.screenshot }) : {};
  recordScreen(job, { scenario: name, status, message, checks: [...checks, ...design], ...bundle });
}

/**
 * 화면 결과를 기록하는 유일한 곳. 기기·연결 실패는 여기서 점검 못 함(inconclusive)으로 바꾼다.
 * 넣은 화면을 돌려줘 부른 쪽이 확정 상태를 본다.
 */
function recordScreen(job: DeviceJob, screen: DeviceScreen): DeviceScreen {
  const recorded = { ...screen, ...classify(screen) };
  job.outcome.screens.push(recorded);
  job.deps.onUpdate(job.run);
  return recorded;
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
  // 기준 화면과 그림만 다른 화면도 정상으로 열린 것이다. 기준이 오래되면(2026-11-16 10월 기준) 거의 모든 화면이 여기 걸려 화면 지도가 안 채워졌다
  const opened = result.status === "passed" || result.status === "candidate" || (result.status === "failed" && result.message === diffMessage);
  if (!job.request.buttonCheck || !setup || !opened) return { result };
  job.outcome.current = `${scenario.name} · 버튼 눌러보기`;
  job.deps.onUpdate(job.run);
  const ring = capture?.ring ?? new LogRing();
  // 시나리오 주소가 다른 화면으로 넘어가 열리면(「/」 → 「/home」) 실제로 열린 주소를 기준으로 한다.
  // 시나리오 주소로 비교하면 첫 버튼 뒤 「화면 복귀 실패」로 나머지를 다 건너뛰고, 지도에도 「/」로 남았다(2026-11-16 홈)
  const openedPath = await driver.currentPath().catch(() => scenario.path);
  // 바깥 사이트의 버튼은 누르지 않는다
  if (driver.onAppSite && !(await driver.onAppSite().catch(() => true))) return { result: { ...result, message: joinMessage(result.message, externalSiteNote) } };
  // 다른 화면으로 넘어가 열렸는데 그 화면을 이 점검이 따로 보면 같은 버튼을 또 누르지 않는다
  //
  const seenElsewhere = !samePath(openedPath, scenario.path) && (job.pressedPaths?.has(normalizePath(openedPath)) || scenariosOf(job.request, job.deps).some((item) => samePath(item.path, openedPath)));
  if (seenElsewhere) return { result: { ...result, message: joinMessage(result.message, buttonsSeenElsewhere(openedPath)) } };
  (job.pressedPaths ??= new Set()).add(normalizePath(openedPath));
  // 쓰기 요청 가드는 버튼을 누르는 동안만 켠다. 점검 내내 켜 두면 뒤 플로우의 광고 시작 요청(`/ad-reward/nonce`)까지 막혀
  // 「광고 시청」·「모으기」가 「광고 화면이 뜨지 않았고」로 앱 오류가 됐다
  const unguard = await guardButtons(job, driver);
  if (!job.request.buttonCheck) return { result };
  let buttons: ButtonResult[];
  try {
    buttons = await pressAll(setup, driver, ring, openedPath, scenario, () => isStopped(job));
  } catch (error) {
    // 버튼 목록을 읽거나 누르는 사이 화면이 넘어가 evaluate가 깨져도 점검 전체를 멈추지 않는다. 화면 결과는 그대로 둔다.
    if (isOffline(error)) throw error;
    const note = `버튼 눌러보기 중단: ${errorMessage(error).split("\n")[0]}`;
    logOf(job.deps)(`${job.device.id} ${scenario.name} ${note}`);
    return { result: { ...result, message: result.message ? `${result.message} · ${note}` : note } };
  } finally {
    await unguard?.().catch((error: unknown) => {
      job.guardLeft = true;
      logOf(job.deps)(`${job.device.id} 버튼 가드 해제 실패: ${errorMessage(error)}`);
    });
  }
  return finishButtons(job, setup, result, openedPath, buttons);
}

/** 넘어가 열린 화면이라 버튼을 다시 누르지 않았다는 메시지 */
export const buttonsSeenElsewhere = (path: string) => `버튼은 ${path} 화면에서 봄`;
/** 앱 밖 사이트라 버튼을 누르지 않았다는 메시지 */
export const externalSiteNote = "바깥 사이트라 버튼은 누르지 않음";
const joinMessage = (message: string | undefined, note: string) => (message ? `${message} · ${note}` : note);

/** 넘어가 열리는 화면이 원래 열렸던 주소까지 가기를 기다리는 시간·간격 (작성자 판단) */
const redirectWaitMs = 5_000;
const redirectPollMs = 250;

function pressAll(setup: ButtonCheckSetup, driver: ScreenDriver, ring: LogRing, openedPath: string, scenario: ScreenScenario, stopped: () => boolean): Promise<ButtonResult[]> {
  const reopen = async () => {
    await driver.navigate(scenario.path);
    await waitForScreen(driver, scenario.path);
    // 늦게 넘어가는 화면은 넘어가기 전에 「화면 복귀 실패」가 됐다
    if (samePath(openedPath, scenario.path)) return;
    const deadline = Date.now() + redirectWaitMs;
    while (Date.now() < deadline && !samePath(openedPath, await driver.currentPath().catch(() => ""))) await sleep(redirectPollMs);
  };
  return (setup.checkButtons ?? defaultCheckButtons)(driver, {
    probe: (since) => setup.probe(driver, ring, since),
    screenPath: openedPath,
    stopped,
    restore: async () => {
      // 딥링크로 다시 열기만 하면 앱이 WebView 스택을 계속 쌓아 메모리 부족으로 죽을 수 있다. 스택을 먼저 닫는다.
      await driver.goHome?.();
      await reopen();
    },
    recover: driver.relaunch
      ? async () => {
          await driver.relaunch?.();
          await reopen();
        }
      : undefined,
  });
}

function finishButtons(job: DeviceJob, setup: ButtonCheckSetup, result: ScreenCheck, openedPath: string, buttons: ButtonResult[]): { result: ScreenCheck; buttons?: ButtonResult[] } {
  try {
    setup.recordMap?.(openedPath, buttons);
  } catch (error) {
    // 지도는 부가 기록이다. 못 써도 점검 결과는 바꾸지 않는다.
    logOf(job.deps)(`화면 지도 기록 실패: ${errorMessage(error)}`);
  }
  const summary = summarizeButtons(buttons);
  const message = result.message ? `${result.message} · ${summary}` : summary;
  // 기준과 다른 화면이면 찍은 그림을 남긴다. 버튼 에러가 같이 나면 비교 그림이 사라졌다
  if (buttons.some((button) => button.status === "error")) return { result: { status: "failed", message, ...(result.status === "failed" ? { screenshot: result.screenshot } : {}) }, buttons };
  return { result: { ...result, message }, buttons };
}

export const infraSkipMessage = "기기 연결이 계속 끊겨 남은 점검을 건너뜀";
/** 화면 하나를 도는 중 점검기에서 새어 나온 오류의 머리말. 점검 못 함으로 남는다 */
export const checkerErrorPrefix = "점검기 오류로 이 화면을 끝까지 못 봄: ";

/** 확정된 화면으로 연속 점검 못 함 수를 센다. 한도에 닿으면 true */
function noteStreak(job: DeviceJob, recorded: DeviceScreen): boolean {
  job.infraStreak = recorded.status === "inconclusive" ? (job.infraStreak ?? 0) + 1 : 0;
  return job.infraStreak >= infraStreakLimit;
}

/** 연결이 계속 끊긴 기기: 남은 시나리오·플로우를 돌리지 않고 점검 못 함으로 남긴다 */
function skipRest(job: DeviceJob, names: readonly string[], message: string = infraSkipMessage): void {
  for (const name of names) recordScreen(job, { scenario: name, status: "inconclusive", message });
}

const flowNamesOf = (job: DeviceJob) => flowsOf(job.request, job.deps).map((flow) => `${flowScenarioPrefix}${flow.name}`);

const hasBundle = (bundle: BundlePaths) => bundle.logDir != null;

async function discardBundle(job: DeviceJob, bundle: BundlePaths): Promise<void> {
  if (!bundle.logDir) return;
  await rm(path.join(job.deps.resultsRoot ?? testResultsRoot, bundle.logDir), { recursive: true, force: true }).catch((error: unknown) => logOf(job.deps)(`${bundle.logDir} 첫 시도 묶음을 못 지웠습니다: ${errorMessage(error)}`));
}

/**
 * 다시 돌리기 전에 앱 상태를 되돌린다. 기기·연결 실패면 드라이버째 새로, 아니면 앱을 다시 켜고 홈으로(실패하면 새로).
 * 앱을 그대로 두면 쌓인 웹 화면·남은 팝업도 그대로라 두 번째도 같은 이유로 실패했다
 *. 진짜 앱 버그는 다시 켜도 남는다.
 */
async function resetForRetry(session: DriverSession, first: Attempt): Promise<void> {
  if (isInfraFailure(first.message)) return session.reopen();
  try {
    await session.driver.relaunch?.();
    await session.driver.goHome?.();
  } catch {
    // 홈으로도 못 가면 앱 상태를 믿을 수 없다. 드라이버째 새로 연다
    await session.reopen();
  }
}

/** lost: 다시 열기에 실패해 이 기기에서는 더 돌 수 없다 */
type Retried<R> = { result: R; bundle: BundlePaths; lost?: true };

/**
 * 한 번 돌리고, 실패면 한 번 더 돌려 settleRetry로 확정한다.
 * 다시 돌리지 않은 결과의 묶음은 부른 쪽이 만든다. 다시 돌렸으면 남는 시도의 묶음만 남긴다.
 */
async function withRetry<R extends Attempt>(job: DeviceJob, session: DriverSession, name: string, attempt: (isRetry: boolean) => Promise<R>, options: { retryable: boolean; scenario?: ScreenScenario }): Promise<Retried<R>> {
  const first = await attempt(false);
  if (!shouldRetry(first, options) || (job.retries ?? 0) >= maxRetriesPerDevice || isStopped(job)) return { result: first, bundle: {} };
  job.retries = (job.retries ?? 0) + 1;
  logOf(job.deps)(`${job.device.id} ${name} 다시 돌림: ${first.message ?? ""}`);
  const firstBundle = session.capture ? await bundleFailure(job, session.driver, session.capture, name, first, options.scenario) : {};
  try {
    await resetForRetry(session, first);
  } catch (error) {
    if (isOffline(error)) throw error;
    // 다시 열기 실패로 기기 전체를 잃지 않는다. 지금 것은 첫 결과로, 남은 것은 부른 쪽이 건너뜀으로 남긴다(최종 리뷰)
    logOf(job.deps)(`${job.device.id} ${name} 다시 열기 실패: ${errorMessage(error)}`);
    return { result: first, bundle: firstBundle, lost: true };
  }
  const second = await attempt(true);
  const settled = settleRetry(first, second);
  if (settled.from === "first") return { result: first, bundle: firstBundle };
  await discardBundle(job, firstBundle);
  return { result: { ...second, status: settled.status, message: settled.message }, bundle: {} };
}

/** 확정 결과가 실패·점검 못 함인데 묶음이 없으면 지금 화면으로 만든다 */
async function bundleIfFailed(job: DeviceJob, session: DriverSession, name: string, result: ScreenCheck, bundle: BundlePaths, scenario?: ScreenScenario, keepPassed = false): Promise<BundlePaths> {
  const wanted = result.status === "failed" || result.status === "inconclusive" || (keepPassed && result.status === "passed");
  if (hasBundle(bundle) || !session.capture || !wanted) return bundle;
  return bundleFailure(job, session.driver, session.capture, name, result, scenario);
}

/** 화면 시나리오 하나. 확정 상태가 다음 점검을 멈춰야 하면 true(로그인 필요·연속 끊김) */
async function scenarioOne(job: DeviceJob, session: DriverSession, scenario: ScreenScenario, rest: readonly string[]): Promise<boolean> {
  const checked = await withRetry(job, session, scenario.name, () => checkOne(job, session.driver, scenario), { retryable: true, scenario });
  const opened = checked.result;
  if (checked.lost) {
    recordScreen(job, { scenario: scenario.name, status: opened.status, message: opened.message, ...checked.bundle });
    skipRest(job, rest);
    return true;
  }
  if (opened.status === "passed" || opened.status === "candidate") await recordLayout(job, session.driver, session.capture, scenario.path);
  const { result, buttons } = await pressButtons(job, session.driver, session.capture, scenario, opened);
  const bundle = await bundleIfFailed(job, session, scenario.name, result, checked.bundle, scenario);
  const recorded = recordScreen(job, { scenario: scenario.name, status: result.status, message: result.message, buttons, ...bundle });
  if (recorded.status === "login_required") return true;
  if (!noteStreak(job, recorded)) return false;
  skipRest(job, rest);
  return true;
}

/** 이번에 볼 화면 시나리오. `scenarioNames`가 있으면 그 이름만(목록 순서) */
function scenariosOf(request: RunRequest, deps: RunDeps): readonly ScreenScenario[] {
  const names = request.scenarioNames;
  const picked = names ? deps.scenarios.filter((scenario) => names.includes(scenario.name)) : deps.scenarios;
  return picked.filter((scenario) => !isSkipped(request, scenario.name));
}

/** 시나리오를 목록 순서로. login_required·연속 끊김이면 멈춘다. 연결 끊김(offline)은 throw로 올린다. */
async function runScenarios(job: DeviceJob, session: DriverSession): Promise<void> {
  if (job.request.designOnly) return runPolicyScreens(job, session.driver, session.capture);
  const scenarios = job.request.flowsOnly ? [] : scenariosOf(job.request, job.deps);
  for (const [index, scenario] of scenarios.entries()) {
    if (isStopped(job)) return;
    job.outcome.phase = "checking";
    job.outcome.current = scenario.name;
    job.deps.onUpdate(job.run);
    const rest = [...scenarios.slice(index + 1).map((item) => item.name), ...flowNamesOf(job)];
    try {
      if (await scenarioOne(job, session, scenario, rest)) return;
    } catch (error) {
      // 화면 하나에서 새어 나온 점검기 오류(evaluate 깨짐 등)로 기기 전체를 끝내지 않는다. 그 화면만 점검 못 함으로 남긴다.
      if (isOffline(error)) throw error;
      recordScreen(job, { scenario: scenario.name, status: "inconclusive", message: `${checkerErrorPrefix}${errorMessage(error).split("\n")[0]}` });
    }
  }
  if (job.request.scenarioNames) return;
  if (await runFlows(job, session)) return;
  // 「플로우만 점검」은 데이터·정책 점검까지 돌아 정책 화면 99개를 더 봤다(2026-11-12). 플로우만 돈다
  if (job.request.flowsOnly) return;
  await runQaScreens(job, session.driver, session.capture);
  await runPolicyScreens(job, session.driver, session.capture);
}

/** 결과 목록 앞머리. 점검 이름(플로우 점검·데이터 점검·정책 점검)과 같게 둔다 (2026-11-12, 예전: 「플로우 · 」 등) */
export const flowScenarioPrefix = "플로우 점검 · ";
export const layoutScenarioPrefix = "화면 깨짐 점검 · ";

/**
 * 지금 열린 화면을 재고, 깨졌으면 `화면 깨짐 점검 · 경로`로 결과에 남긴다(docs/design-device-farm.md).
 * 통과한 화면은 남기지 않는다 — 화면마다 한 줄씩 늘어 결과 목록이 두 배가 된다.
 */
async function recordLayout(job: DeviceJob, driver: ScreenDriver, capture: DeviceCapture | null, screenPath: string): Promise<void> {
  job.layoutChecked ??= new Set();
  if (job.layoutChecked.has(screenPath)) return;
  job.layoutChecked.add(screenPath);
  const checks = await (job.deps.checkLayout ?? defaultCheckLayout)(driver, screenPath, logOf(job.deps));
  const message = layoutMessage(checks);
  if (!message) return;
  const name = `${layoutScenarioPrefix}${screenPath}`;
  const bundle = capture ? await bundleFailure(job, driver, capture, name, { status: "failed", message }) : {};
  recordScreen(job, { scenario: name, status: "failed", message, checks, ...bundle });
}
export const qaScenarioPrefix = "데이터 점검 · ";
export const policyScenarioPrefix = "정책 점검 · ";

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
    if (isSkipped(job.request, name)) continue;
    job.outcome.phase = "checking";
    job.outcome.current = name;
    job.deps.onUpdate(job.run);
    const report = await qaOne(runQa, driver, screen);
    const failed = report.checks.filter((check) => !check.ok);
    const message = failed.length > 0 ? `${failed.length}개 실패 · ${failed[0].title}: ${failed[0].message ?? ""}` : undefined;
    const status = failed.length > 0 ? "failed" : "passed";
    const bundle = status === "failed" && capture ? await bundleFailure(job, driver, capture, name, { status: "failed", message }) : {};
    recordScreen(job, { scenario: name, status, message, checks: report.checks, ...bundle });
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

/** 이번에 볼 디자인(정책) 화면. `designPaths`가 있으면 그 경로만 */
export const designScreensOf = (request: RunRequest, deps: Pick<RunDeps, "policyScreens">) =>
  (deps.policyScreens ?? []).filter((screen) => !request.designPaths || request.designPaths.includes(screen.path));

/** 정책 대조 화면을 순서대로. 어긋남은 실패가 아니고, 무시하지 않은 "버그 후보"가 있을 때만 그 화면을 실패로 둔다 */
async function runPolicyScreens(job: DeviceJob, driver: ScreenDriver, capture: DeviceCapture | null): Promise<void> {
  const { runPolicy } = job.deps;
  if (!runPolicy) return;
  for (const screen of designScreensOf(job.request, job.deps)) {
    if (isStopped(job)) return;
    const name = `${policyScenarioPrefix}${screen.path}`;
    if (isSkipped(job.request, name)) continue;
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
    if (!report.checks.some((check) => check.id === "open")) await recordLayout(job, driver, capture, screen.path);
    await recordPolicy(job, driver, capture, name, report);
  }
}

/** 정책 대조 결과 한 줄. 이름은 `정책 점검 · 경로`라야 슬랙 알림·디자인 오류·아침 분석이 읽는다 */
async function recordPolicy(job: DeviceJob, driver: ScreenDriver, capture: DeviceCapture | null, name: string, report: PolicyScreenReport, note?: string): Promise<void> {
  const status = hasBugCandidate(report.checks) ? "failed" : "passed";
  const message = [note, policyMessage(report)].filter(Boolean).join(" · ") || undefined;
  const bundle = status === "failed" && capture ? await bundleFailure(job, driver, capture, name, { status: "failed", message }) : {};
  const coverage = report.figmaCoverage === undefined ? {} : { figmaCoverage: report.figmaCoverage };
  recordScreen(job, { scenario: name, status, message, checks: report.checks, ...coverage, ...bundle });
}

/** 플로우 「디자인 확인」: 지금 화면의 화면 깨짐을 재고, 피그마·정책이 연결된 화면이면 대조한다. 실패해도 플로우는 이어 간다 */
async function designStep(job: DeviceJob, driver: ScreenDriver, capture: DeviceCapture | null, flow: FlowDocument, index: number): Promise<void> {
  const path = normalizePath(await driver.currentPath());
  await recordLayout(job, driver, capture, path);
  const screen = job.deps.designScreenFor?.(path) ?? null;
  const note = `플로우 「${flow.name}」 ${index + 1}단계`;
  if (!screen || !job.deps.runDesign) {
    logOf(job.deps)(`${note} 디자인 확인: ${path}에 연결된 피그마·정책이 없어 화면 깨짐만 쟀습니다.`);
    return;
  }
  let report: PolicyScreenReport;
  try {
    report = await job.deps.runDesign(driver, screen);
  } catch (error) {
    if (isOffline(error)) throw error;
    report = { path, checks: [], situational: 0, cached: false, judgeError: errorMessage(error) };
  }
  await recordPolicy(job, driver, capture, `${policyScenarioPrefix}${path}`, report, note);
}

/** 스텝 index를 시작했을 때의 진행 패널 목록 */
function flowStepViews(flow: FlowDocument, running: number): FlowStepView[] {
  return withHome(flow).map((step, index) => ({
    label: `${stepLabels[step.type]} 「${stepTarget(step)}」`,
    status: index < running ? "passed" : index === running ? "running" : "pending",
  }));
}

/**
 * 플로우 하나가 넘으면 버리고 다음으로 가는 시간 (작성자 판단). 광고(최대 90초)·적립 대기를 넉넉히 넘는 값.
 */
export const flowTimeoutMs = 10 * 60_000;

async function flowOne(job: DeviceJob, driver: ScreenDriver, flow: FlowDocument, capture: DeviceCapture | null): Promise<FlowResult> {
  let running = 0;
  const onStep = (index: number) => {
    running = index;
    job.outcome.flowSteps = flowStepViews(flow, index);
    job.deps.onUpdate(job.run);
  };
  const limitMs = job.deps.flowTimeoutMs ?? flowTimeoutMs;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const step = withHome(flow)[running];
      const where = step ? `${running + 1}단계 ${stepLabels[step.type]} 「${stepTarget(step)}」에서 ` : "";
      reject(new Error(`플로우가 ${Math.round(limitMs / 60_000)}분 안에 끝나지 않아 ${where}멈추고 다음으로 넘어갔습니다.`));
    }, limitMs);
  });
  try {
    const checkDesign = (target: ScreenDriver, index: number) => designStep(job, target, capture, flow, index);
    const work = (job.deps.runFlow ?? ((target, item, step) => defaultRunFlow(target, item, { onStep: step, checkDesign, onTrace: (line) => capture?.ring.push({ source: "system", text: `[점검] ${line}` }) })))(driver, flow, onStep);
    return await Promise.race([work, timeout]);
  } catch (error) {
    if (isOffline(error)) throw error;
    return { status: "failed", steps: [], message: errorMessage(error) };
  } finally {
    clearTimeout(timer);
  }
}

/** 이번에 돌 확정 플로우. `flowIds`가 있으면 그것만 */
const flowsOf = (request: RunRequest, deps: RunDeps) =>
  [...(deps.flows ?? []), ...(request.adhocFlows ?? [])].filter((flow) => (!request.flowIds || request.flowIds.includes(flow.id)) && !isSkipped(request, `${flowScenarioPrefix}${flow.name}`));

/** 이어서 돌릴 때 이미 본 항목인지 */
function isSkipped(request: RunRequest, name: string): boolean {
  return request.skipNames?.includes(name) ?? false;
}

/** 실패한 플로우 중에 점검기가 앱 요청을 막았으면 앱 탓인지 알 수 없다. 점검 못 함으로 남게 사유를 붙인다(다시 돌 때 드라이버를 새로 연다) */
function withBlocked(result: FlowResult, blocked: readonly BlockedRequest[], app: AppConfig): FlowResult {
  const harmful = blocked.find((request) => !isHarmlessBlocked(request.path, app.guard.harmlessBlockedPatterns));
  if (result.status !== "failed" || !harmful) return result;
  return { ...result, message: blockedByFarmMessage(`${harmful.method} ${harmful.path}`, result.message) };
}

/** 다시 돌린 플로우도 실패했는데 로그인 화면이면 로그인 필요. 첫 시도는 보지 않는다 — 다시 돌기·재로그인을 건너뛰지 않게 */
async function flowAttempt(job: DeviceJob, session: DriverSession, flow: FlowDocument, isRetry: boolean): Promise<FlowResult | (Omit<FlowResult, "status"> & { status: "login_required" })> {
  const blockedBefore = job.blocked?.length ?? 0;
  const ran = await flowOne(job, session.driver, flow, session.capture);
  const result = withBlocked(ran, (job.blocked ?? []).slice(blockedBefore), job.deps.app);
  if (result.status !== "failed" || !isRetry) return result;
  const where = await session.driver.currentPath().catch(() => "");
  return isLoginPath(where, job.deps.app.loginPaths) ? { ...result, status: "login_required" } : result;
}

/** 확정 플로우를 순서대로. 결과는 화면 결과와 같은 목록에 `플로우 점검 · 이름`으로 남는다. 멈춰야 하면 true */
async function runFlows(job: DeviceJob, session: DriverSession): Promise<boolean> {
  const flows = flowsOf(job.request, job.deps);
  if (job.guardLeft && flows.length > 0) {
    // 풀지 못한 쓰기 차단이 남으면 광고·퀴즈 요청까지 막힌다. 새 연결에서 시작한다
    logOf(job.deps)(`${job.device.id} 버튼 가드를 풀지 못해 플로우 전에 드라이버를 새로 엽니다.`);
    try {
      await session.reopen();
      job.guardLeft = false;
    } catch (error) {
      if (isOffline(error)) throw error;
      logOf(job.deps)(`${job.device.id} 다시 열기 실패: ${errorMessage(error)}`);
      skipRest(job, flowNamesOf(job));
      return true;
    }
  }
  for (const [index, flow] of flows.entries()) {
    if (isStopped(job)) return true;
    const name = `${flowScenarioPrefix}${flow.name}`;
    job.outcome.phase = "checking";
    job.outcome.current = name;
    job.deps.onUpdate(job.run);
    const retried = await withRetry(job, session, name, (isRetry) => flowAttempt(job, session, flow, isRetry), { retryable: flow.retry !== false });
    const { bundle: kept, lost } = retried;
    const result = await withServerCheck(job, retried.result);
    delete job.outcome.flowSteps;
    const rest = flows.slice(index + 1).map((item) => `${flowScenarioPrefix}${item.name}`);
    const bundle = await bundleIfFailed(job, session, name, { status: result.status, message: result.message }, kept, undefined, job.request.keepScreenshot);
    const recorded = recordScreen(job, { scenario: name, status: result.status, message: result.message, steps: result.steps, ...bundle });
    if (recorded.status === "login_required") return true;
    // 홈 실패 연속을 먼저 본다. 서버 탓이면 점검 못 함 연속과 함께 닿는데, 이유는 서버 쪽이 맞다
    if (!lost && (noteHomeStreak(job, recorded, rest) || noteServerStreak(job, recorded, rest))) return true;
    if (lost || noteStreak(job, recorded)) {
      skipRest(job, rest);
      return true;
    }
  }
  return false;
}

/**
 * 실패한 플로우면 기록 전에 dev 서버(웹·API)를 확인한다. 정상 응답하지 않으면 점검 못 함으로 바꾼다.
 * 기록하는 순간 슬랙에 가므로 기록 전에 가른다. 서버 이유를 `job.homeServer`에 남겨 건너뛰기 메시지에 쓴다.
 */
async function withServerCheck<R extends Attempt>(job: DeviceJob, result: R): Promise<R> {
  const home = isHomeStartFailure(result);
  if ((!home && result.status !== "failed") || !job.deps.serverHealth) return result;
  const server = await job.deps.serverHealth(job.request.kind).catch((error: unknown) => `확인 실패: ${errorMessage(error)}`);
  job.homeServer = server;
  return server ? { ...result, status: "inconclusive", message: `${serverDownPrefix(server)}${result.message ?? ""}` } : result;
}

/** 「홈에서 시작」 연속 실패를 센다. `homeStreakLimit`에 닿으면 남은 플로우를 건너뛴다(true) */
function noteHomeStreak(job: DeviceJob, recorded: DeviceScreen, rest: readonly string[]): boolean {
  job.homeStreak = isHomeStartFailure(recorded) ? (job.homeStreak ?? 0) + 1 : 0;
  if (job.homeStreak < homeStreakLimit) return false;
  const message = homeSkipMessage(job.homeServer ?? null);
  logOf(job.deps)(`${job.device.id} ${message}`);
  for (const name of rest) recordScreen(job, { scenario: name, status: "inconclusive", message });
  return true;
}

/** 서버 탓 점검 못 함이 단계와 상관없이 `serverStreakLimit`번 이어지면 남은 플로우를 서버 이유로 건너뛴다(true) */
function noteServerStreak(job: DeviceJob, recorded: DeviceScreen, rest: readonly string[]): boolean {
  job.serverStreak = isServerDown(recorded.message) ? (job.serverStreak ?? 0) + 1 : 0;
  if (job.serverStreak < serverStreakLimit) return false;
  const message = homeSkipMessage(job.homeServer ?? "응답 없음");
  logOf(job.deps)(`${job.device.id} ${message}`);
  skipRest(job, rest, message);
  return true;
}

/** 시작하기 전에 서버가 정상인지 본다. 배포 중일 수 있어 잠깐 기다린다. 끝내 아니면 이유 */
async function serverProblem(job: DeviceJob): Promise<string | null> {
  if (!job.deps.serverHealth) return null;
  const deadline = Date.now() + (job.deps.serverStartWaitMs ?? serverStartWaitMs);
  for (let logged = false; ; logged = true) {
    const server = await job.deps.serverHealth(job.request.kind).catch((error: unknown) => `확인 실패: ${errorMessage(error)}`);
    if (!server || Date.now() >= deadline || isStopped(job)) return server;
    if (!logged) logOf(job.deps)(`${job.device.id} 앱 웹 서버가 정상 응답하지 않아(${server}) 점검을 시작하기 전에 기다립니다.`);
    await sleep(serverStartPollMs);
  }
}

/** 이번 점검이 돌 항목 이름(서버 탓에 시작하지 못할 때 남긴다) */
function plannedNames(job: DeviceJob): string[] {
  const { request, deps } = job;
  if (request.designOnly) return designScreensOf(request, deps).map((screen) => `${policyScenarioPrefix}${screen.path}`);
  const screens = request.flowsOnly ? [] : scenariosOf(request, deps).map((item) => item.name);
  return request.scenarioNames ? screens : [...screens, ...flowNamesOf(job)];
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
    return await job.deps.buttonCheck.guard(driver, (request) => void (job.blocked ??= []).push(request));
  } catch (error) {
    job.request = { ...job.request, buttonCheck: false };
    job.outcome.message = `버튼 눌러보기를 건너뜀: ${errorMessage(error)}`;
    return null;
  }
}

/** 드라이버를 열고 로그 수집·네트워크·팝업·버튼 가드를 씌운다. reopen은 닫고 같은 순서로 다시 연다 */
async function openSession(job: DeviceJob, appId: string): Promise<DriverSession> {
  const log = logOf(job.deps);
  const connect = async () => {
    const rawDriver = await job.deps.openDriver(job.device, appId);
    const capture = await startCapture(job, rawDriver, appId);
    // 네트워크 오류 화면은 다시 불러 고치고(network/specs), 팝업은 점검 항목으로 남기고 닫는다(popups/specs)
    const driver = withPopupGuard(withNetworkRecovery(rawDriver, log), { onPopup: (event) => recordPopup(job, rawDriver, capture, event), log });
    return { driver, capture };
  };
  type Connection = Awaited<ReturnType<typeof connect>>;
  let current: Connection = await connect();
  let closed = false;
  // 다시 열기가 실패한 뒤 testDevice finally가 이미 닫은 연결을 또 닫지 않게
  const close = async () => {
    if (closed) return;
    closed = true;
    // 통과한 기기의 링버퍼·프레임은 여기서 버려진다. 남는 것은 DB 실행 기록뿐이다.
    await stopCapture(job, current.capture);
    // 연결이 끊긴 뒤의 close 실패는 이미 offline으로 남으므로 결과를 바꾸지 않는다.
    await current.driver.close().catch(() => undefined);
  };
  return {
    get driver() {
      return current.driver;
    },
    get capture() {
      return current.capture;
    },
    reopen: async () => {
      await close();
      current = await connect();
      closed = false;
    },
    close,
  };
}

async function testDevice(job: DeviceJob): Promise<void> {
  if (isStopped(job)) {
    settle(job, "skipped", stoppedMessage);
    return;
  }
  if (!job.request.flowsOnly && !job.request.designOnly && !job.request.scenarioNames && !job.request.skipInstall) {
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
  const server = await serverProblem(job);
  if (isStopped(job)) {
    settle(job, "skipped", stoppedMessage);
    return;
  }
  if (server) {
    skipRest(job, plannedNames(job), serverNotReadyMessage(server));
    settle(job, screensOutcome(job.outcome), serverNotReadyMessage(server));
    return;
  }
  const session = await openSession(job, appIdFor(job.deps.app, job.request.kind, job.device.platform));
  try {
    await runScenarios(job, session);
  } finally {
    await session.close();
  }
  // 슬랙에서 「문제 아님」을 누른 실패는 통과로 넘긴다
  skipIgnoredFailures(job.outcome.screens, (job.deps.readIgnores ?? readIgnores)());
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
    ...(request.label ? { label: request.label } : {}),
    scenarioCount: Math.max(0, (request.designOnly
      ? designScreensOf(request, deps).length
      : request.scenarioNames
        ? scenariosOf(request, deps).length
        : (request.flowsOnly ? 0 : scenariosOf(request, deps).length) + flowsOf(request, deps).length + (request.flowsOnly ? 0 : qaScreensOf(deps).length)) -
      // 데이터 점검은 위 목록에서 걸러지지 않았다(정책은 원래 세지 않는다). 이어서 돌리면 이미 본 만큼 뺀다
      (request.designOnly ? 0 : (request.skipNames?.filter((name) => name.startsWith(qaScenarioPrefix)).length ?? 0))),
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

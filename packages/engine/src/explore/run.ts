import path from "node:path";

import type { ScreenDriver } from "@device-farm/core/device/driver";
import type { DeviceLocks, LockOwner } from "@device-farm/core/device/lock";
import { appIdFor, type AppConfig } from "@device-farm/core/config/app-config";
import { deviceConcurrency, type Device } from "@device-farm/core/device/types";
import { type ExplorePath } from "@device-farm/core/explore/actions";
import { guardAndroidPage, guardTargetOf, isExternal, type BlockedRequest } from "@device-farm/core/explore/guard";
import type { Allowlist } from "@device-farm/core/explore/policy";
import { probeScreen, type Issue } from "@device-farm/core/explore/probe";
import { LogRing } from "@device-farm/core/logs/ring";
import type { AndroidScreenDriver } from "@device-farm/devices/android-driver";

import { writeFailureBundle, type FailureBundleInput } from "../results";
import {
  createRunId,
  eachLimited,
  errorMessage,
  humanControlMessage,
  pathSegment,
  pickDevices,
  testResultsRoot,
  type DeviceCapture,
} from "../run";
import { crawl as defaultCrawl, replay as defaultReplay } from "./crawler";
import { cleanAndroidPaths, readExploreRun, writeExploreResult, type ExploreResult } from "./results";

export const devOnlyMessage = "dev 빌드에서만 탐색합니다.";
export const noAndroidMessage = "Android 탐색 결과가 없습니다.";
export const iosCleanOnlyMessage = "iOS는 Android에서 차단 없이 끝난 경로만 다시 돕니다.";

export type Guard = (driver: ScreenDriver, webOrigin: string, allowlist: Allowlist, onBlocked: (request: BlockedRequest) => void) => Promise<() => Promise<void>>;
export type Probe = (driver: ScreenDriver, ring: LogRing, since: number, allowlist: Allowlist) => Promise<Issue[]>;

export interface ExploreDeps {
  /** 점검 대상 앱 설정. 탐색은 dev 앱만 연다 */
  app: AppConfig;
  locks: DeviceLocks;
  /** `appVersion`은 dev 앱(`app.appIds.dev`) 기준. null이면 dev 앱이 깔려 있지 않다. */
  listDevices: () => Promise<Device[]>;
  openDriver: (device: Device, appId: string) => Promise<ScreenDriver>;
  capture?: (device: Device, driver: ScreenDriver, appId: string) => Promise<DeviceCapture>;
  allowlist: Allowlist;
  formValues: Record<string, string>;
  /** dev 앱 WebView 웹 주소 */
  webOrigin: string;
  onUpdate?: (results: ExploreResult[]) => void;
  resultsRoot?: string;
  now?: () => number;
  writeBundle?: (dir: string, input: FailureBundleInput) => Promise<void>;
  guard?: Guard;
  crawl?: typeof defaultCrawl;
  replay?: typeof defaultReplay;
  probe?: Probe;
  log?: (message: string) => void;
}

/** HTTP 상태로 옮길 수 있는 요청 오류(replayOne). */
export class ExploreRequestError extends Error {
  constructor(readonly status: 400 | 404 | 409, message: string) {
    super(message);
  }
}

export interface Session {
  deps: ExploreDeps;
  device: Device;
  driver: ScreenDriver;
  capture: DeviceCapture;
  runId: string;
  bundles: number;
}

type BundlePaths = { screenshot: string; logDir: string };

const emptyBundle: BundlePaths = { screenshot: "", logDir: "" };

function isAndroidDriver(driver: ScreenDriver): driver is AndroidScreenDriver {
  return "context" in driver;
}

/** 가드 없이 Android를 탐색하지 않는다(fail closed). */
export const defaultGuard: Guard = async (driver, webOrigin, allowlist, onBlocked) => {
  if (!isAndroidDriver(driver)) throw new Error("Android 드라이버가 아니라 요청 가드를 켤 수 없습니다.");
  return guardAndroidPage(driver.context, guardTargetOf(driver.app, webOrigin), allowlist, onBlocked);
};

const nowOf = (deps: ExploreDeps) => (deps.now ?? Date.now)();
const logOf = (deps: ExploreDeps) => deps.log ?? ((message: string) => console.warn(`[explore] ${message}`));

/**
 * 오류가 난 화면 하나의 묶음. 같은 화면의 오류들은 묶음 하나를 같이 쓴다(작성자 판단, 영상 인코딩을 한 번만).
 * 경로는 `test-results` 기준 상대 경로.
 */
export async function bundleScreen(session: Session): Promise<BundlePaths> {
  const { deps } = session;
  const root = deps.resultsRoot ?? testResultsRoot;
  session.bundles += 1;
  const dir = path.join(root, "explore", pathSegment(session.runId), pathSegment(session.device.id), `screen-${session.bundles}`);
  const relative = path.relative(root, dir).split(path.sep).join("/");
  let screenshot: Buffer;
  try {
    screenshot = await session.driver.screenshot();
  } catch (error) {
    logOf(deps)(`${relative} 스크린샷을 못 찍어 묶음을 건너뜁니다: ${errorMessage(error)}`);
    return emptyBundle;
  }
  const input = { logs: session.capture.ring.around(nowOf(deps)), frames: session.capture.frames(), screenshot };
  try {
    await (deps.writeBundle ?? writeFailureBundle)(dir, input);
  } catch (error) {
    logOf(deps)(`${relative} 실패 묶음 일부를 못 썼습니다: ${errorMessage(error)}`);
  }
  return { screenshot: `${relative}/screenshot.png`, logDir: relative };
}

function newResult(runId: string, device: Device, now: number): ExploreResult {
  return {
    runId,
    deviceId: device.id,
    platform: device.platform,
    startedAt: new Date(now).toISOString(),
    finishedAt: null,
    paths: [],
    issues: [],
    blocked: [],
    cleanPathIds: [],
    replayFailures: [],
  };
}

function emptyCapture(): DeviceCapture {
  return { ring: new LogRing(), frames: () => [], stop: async () => undefined };
}

async function startCapture(deps: ExploreDeps, device: Device, driver: ScreenDriver): Promise<DeviceCapture> {
  if (!deps.capture) return emptyCapture();
  try {
    return await deps.capture(device, driver, appIdFor(deps.app, "dev", device.platform));
  } catch (error) {
    logOf(deps)(`${device.id} 로그 수집을 못 띄웠습니다: ${errorMessage(error)}`);
    return emptyCapture();
  }
}

/** 봇 잠금 → 드라이버·수집기 → body → 정리. 잠금은 finally에서 푼다. 사람이 쥐고 있으면 false. */
export async function withDevice(deps: ExploreDeps, device: Device, runId: string, body: (session: Session) => Promise<void>): Promise<boolean> {
  const owner: LockOwner = { kind: "bot", runId };
  if (!deps.locks.acquire(device.id, owner)) return false;
  try {
    const driver = await deps.openDriver(device, appIdFor(deps.app, "dev", device.platform));
    const capture = await startCapture(deps, device, driver);
    try {
      await body({ deps, device, driver, capture, runId, bundles: 0 });
    } finally {
      await capture.stop().catch((error: unknown) => logOf(deps)(`${device.id} 로그 수집 정지 실패: ${errorMessage(error)}`));
      // 연결이 끊긴 뒤의 close 실패는 결과를 바꾸지 않는다.
      await driver.close().catch(() => undefined);
    }
  } finally {
    deps.locks.release(device.id, owner);
  }
  return true;
}

function fillBundles(result: ExploreResult, bundles: readonly BundlePaths[]): void {
  result.issues.forEach((issue, index) => {
    const bundle = bundles[index];
    if (bundle) Object.assign(issue, bundle);
  });
}

/** Android: 가드를 켜고 crawl. 오류가 난 화면마다 묶음을 쓰고 이슈에 경로를 채운다. */
async function crawlAndroid(session: Session, result: ExploreResult, publish: () => void): Promise<void> {
  const { deps, driver, capture } = session;
  const blocked: BlockedRequest[] = [];
  const unguard = await (deps.guard ?? defaultGuard)(driver, deps.webOrigin, deps.allowlist, (request) => blocked.push(request));
  // crawl은 issue를 probe가 돌려준 순서대로 쌓는다. bundles[i]가 issues[i]의 묶음이다.
  const bundles: BundlePaths[] = [];
  // ponytail: 경로 시작 시각을 따로 못 받아 blockedSince 호출(= 직전 경로 끝) 이후 로그를 본다. 재생 중 거친 앞 화면 로그도 섞일 수 있다.
  let since = nowOf(deps);
  const probe = async () => {
    const issues = await (deps.probe ?? probeScreen)(driver, capture.ring, since, deps.allowlist);
    const bundle = issues.length > 0 ? await bundleScreen(session) : emptyBundle;
    bundles.push(...issues.map(() => bundle));
    return issues;
  };
  try {
    await (deps.crawl ?? defaultCrawl)({
      driver,
      probe,
      formValues: deps.formValues,
      now: deps.now,
      runId: session.runId,
      deviceId: session.device.id,
      isExternal: async () => isExternal(await driver.evaluate<string>("location.href"), deps.webOrigin, deps.app.apiOrigin || undefined),
      blockedSince: () => {
        since = nowOf(deps);
        return blocked.splice(0);
      },
      onStep: (step) => {
        Object.assign(result, step, { platform: session.device.platform });
        fillBundles(result, bundles);
        publish();
      },
    });
  } finally {
    await unguard();
  }
}

/** iOS: Android에서 차단 없이 끝난 경로만 replay + probe. */
async function replayIos(session: Session, result: ExploreResult, paths: readonly ExplorePath[], publish: () => void): Promise<void> {
  const { deps, driver, capture } = session;
  for (const item of paths) {
    const since = nowOf(deps);
    result.paths.push(item);
    try {
      await (deps.replay ?? defaultReplay)(driver, item);
    } catch (error) {
      result.replayFailures.push({ pathId: item.id, message: errorMessage(error) });
      publish();
      continue;
    }
    const issues = await (deps.probe ?? probeScreen)(driver, capture.ring, since, deps.allowlist);
    const bundle = issues.length > 0 ? await bundleScreen(session) : emptyBundle;
    result.issues.push(...issues.map((issue) => ({ ...issue, pathId: item.id, ...bundle })));
    if (issues.length === 0) result.cleanPathIds.push(item.id);
    publish();
  }
}

interface RunContext {
  runId: string;
  deps: ExploreDeps;
  results: ExploreResult[];
}

function publisher(context: RunContext, result: ExploreResult): () => void {
  return () => {
    writeExploreResult(result, context.deps.resultsRoot);
    context.deps.onUpdate?.(context.results);
  };
}

function skipReason(device: Device, androidPaths: ExplorePath[] | null): string | null {
  if (device.appVersion === null) return devOnlyMessage;
  if (device.platform === "ios" && androidPaths === null) return noAndroidMessage;
  return null;
}

async function exploreDevice(context: RunContext, device: Device, androidPaths: ExplorePath[] | null): Promise<void> {
  const { deps } = context;
  const result = newResult(context.runId, device, nowOf(deps));
  context.results.push(result);
  const publish = publisher(context, result);
  const skip = skipReason(device, androidPaths);
  try {
    if (skip !== null) result.message = skip;
    else {
      const ran = await withDevice(deps, device, context.runId, (session) =>
        device.platform === "android" ? crawlAndroid(session, result, publish) : replayIos(session, result, androidPaths ?? [], publish),
      );
      if (!ran) result.message = humanControlMessage;
    }
  } catch (error) {
    result.message = errorMessage(error);
  } finally {
    result.finishedAt ??= new Date(nowOf(deps)).toISOString();
    publish();
  }
}

/** Android를 먼저 가드를 켜고 탐색하고, iOS는 Android의 깨끗한 경로만 다시 돈다. */
export async function runExplore(request: { deviceIds: readonly string[] | "all"; runId?: string }, deps: ExploreDeps): Promise<ExploreResult[]> {
  const context: RunContext = { runId: request.runId ?? createRunId(nowOf(deps)), deps, results: [] };
  const devices = pickDevices(await deps.listDevices(), request.deviceIds);
  const androids = devices.filter((device) => device.platform === "android");
  await eachLimited(androids, deviceConcurrency, (device) => exploreDevice(context, device, null));
  const androidPaths = cleanAndroidPaths(context.results);
  const iosDevices = devices.filter((device) => device.platform === "ios");
  await eachLimited(iosDevices, deviceConcurrency, (device) => exploreDevice(context, device, androidPaths));
  return context.results;
}

/** 경로 하나를 홈부터 다시 돌고 지금 화면을 검사한다. Android는 가드를 켠 채로. */
async function replayAndProbe(session: Session, item: ExplorePath): Promise<Issue[]> {
  const { deps, driver, capture } = session;
  const blocked: BlockedRequest[] = [];
  const unguard = session.device.platform === "android"
    ? await (deps.guard ?? defaultGuard)(driver, deps.webOrigin, deps.allowlist, (request) => blocked.push(request))
    : async () => undefined;
  try {
    const since = nowOf(deps);
    await (deps.replay ?? defaultReplay)(driver, item);
    const issues = await (deps.probe ?? probeScreen)(driver, capture.ring, since, deps.allowlist);
    // 차단된 쓰기도 다시 돌리기 결과로 보여 준다(Issue 종류가 없어 network로 적는다, 작성자 판단).
    return [...issues, ...blocked.map((request) => ({ kind: "network" as const, message: `차단됨 ${request.method} ${request.path} (${request.reason})` }))];
  } finally {
    await unguard();
  }
}

/** 디바이스팜 "다시 돌리기". iOS는 그 실행의 Android 깨끗한 경로만 받는다. */
export async function replayOne(deviceId: string, runId: string, pathId: string, deps: ExploreDeps): Promise<Issue[]> {
  const results = readExploreRun(runId, deps.resultsRoot);
  const item = results.flatMap((result) => result.paths).find((candidate) => candidate.id === pathId);
  if (!item) throw new ExploreRequestError(404, "다시 돌릴 경로가 없습니다.");
  const device = (await deps.listDevices()).find((candidate) => candidate.id === deviceId);
  if (!device) throw new ExploreRequestError(404, "연결된 기기가 아닙니다.");
  if (device.appVersion === null) throw new ExploreRequestError(400, devOnlyMessage);
  const clean = cleanAndroidPaths(results) ?? [];
  if (device.platform === "ios" && !clean.some((candidate) => candidate.id === pathId)) throw new ExploreRequestError(400, iosCleanOnlyMessage);
  let issues: Issue[] = [];
  const ran = await withDevice(deps, device, `replay-${runId}`, async (session) => {
    issues = await replayAndProbe(session, item);
  });
  if (!ran) throw new ExploreRequestError(409, humanControlMessage);
  return issues;
}

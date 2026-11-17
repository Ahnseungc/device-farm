import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { actionKey, chaosCandidates, statsKey, isAvoidedName, pickStartPath, pickWeighted, scoreAll, seededRandom, type ActionStats, type ChaosAction, type ScoredAction } from "@device-farm/core/chaos/policy";
import { dedupeErrors, judgeIssues } from "@device-farm/core/chaos/judge";
import type { ChaosRun, ChaosStep } from "@device-farm/core/chaos/types";
import { isTabName } from "@device-farm/core/config/app-config";
import type { ScreenDriver } from "@device-farm/core/device/driver";
import type { Device } from "@device-farm/core/device/types";
import { fillScript, hasForbiddenWord, listActionsScript } from "@device-farm/core/explore/actions";
import type { Allowlist } from "@device-farm/core/explore/policy";
import { probeScreen, type Issue } from "@device-farm/core/explore/probe";
import { LogRing } from "@device-farm/core/logs/ring";
import { sleep } from "@device-farm/core/sleep";
import type { AndroidScreenDriver } from "@device-farm/devices/android-driver";
import type { Exec } from "@device-farm/devices/exec";
import { startCollectors } from "@device-farm/devices/logs/collect";

import { checkLayout } from "../layout/check";

import { writeChaosRun } from "./results";

/**
 * 카오스 탐색 실행기(docs/design-chaos.md). 첫 회차는 홈에서, 다음 회차는 깊은 화면(startPaths)에서 시작해
 * 정책이 고른 행동을 하고, 스텝마다 판정해 기록한다. 입력칸에는 테스트 값을 넣는다. 네트워크 끊김·재현 경로 줄이기는 아직 없다.
 */

/** 행동 뒤 화면을 읽기까지 (작성자 판단, 버튼 눌러보기 settleMs와 같다) */
const settleMs = 1_500;
/**
 * 행동 뒤 화면이 비어 있으면 이만큼 더 기다리며 다시 본다 (작성자 판단).
 * 1.5초에 흰 화면이던 상세 화면들이 4초 뒤에는 그려져 빈 화면 오류가 오탐이었다.
 * 이 시간이 지나도 비어 있으면 그때 빈 화면으로 본다.
 */
const blankWaitMs = 5_000;
const blankPollMs = 500;
/** 글자·이미지가 하나도 없는가(빈 화면 판정과 같은 기준). 읽지 못하면 비어 있지 않다고 본다 — 판정은 probe가 한다 */
const isBlankScript = `(() => document.body.innerText.trim().length === 0 && document.body.querySelectorAll("img, svg, canvas, video, picture, iframe").length === 0)()`;

/** 로딩 중 뒤로: 누르고 뒤로 키까지 (설계 문서) */
const backDuringLoadMs = 300;
/** 백그라운드·다른 앱에 두는 시간 (설계 문서) */
const backgroundMs = 3_000;
/** 「다른 앱 다녀오기」에 띄우는 앱: 기기마다 있고 네트워크·계정을 안 쓰는 안드로이드 설정 */
const otherAppIntent = ["am", "start", "-a", "android.settings.SETTINGS"] as const;
/** 앱 밖에 다녀온 행동. 이 뒤 빈 화면은 「돌아온 뒤 흰 화면」으로 적는다 */
const returnKinds: readonly ChaosAction["kind"][] = ["background", "otherApp"];
/** 재시작 뒤 WebView가 뜨기를 기다리는 시간 (작성자 판단) */
const restartWaitMs = 8_000;
/** 연타 횟수 (설계 문서) */
const doubleTapCount = 3;
/**
 * 행동이 연달아 이만큼 실패하면 멈춤으로 기록하고 앱을 재시작한다 (작성자 판단).
 * 약관 화면 「닫기」 뒤 무엇을 눌러도 화면이 안 바뀐 채 20스텝 넘게 보낸 회차가 있었다.
 */
const stuckAfterFailures = 3;
/** 기록에 남길 후보 수 */
const recordedCandidates = 8;

export interface ChaosDeps {
  device: Device;
  appId: string;
  exec: Exec;
  /** 드라이버를 연다. 앱 재시작 뒤에는 CDP 연결이 끊겨 다시 연다. */
  openDriver: () => Promise<AndroidScreenDriver>;
  /** 쓰기 요청 가드. 해제 함수를 돌려준다. */
  guard: (driver: AndroidScreenDriver, onBlocked: (line: string) => void) => Promise<() => Promise<void>>;
  allowlist: Allowlist;
  seed: number;
  episodes: number;
  stepsPerEpisode: number;
  minutes: number;
  /** 둘째 회차부터 시작할 깊은 화면 후보(deepStartPool). 없으면 모든 회차를 홈에서 */
  startPaths?: readonly string[];
  /** 입력칸 채우기. 쓰기 가드가 없으면(--no-guard) 끈다 — 넣은 값으로 등록·저장이 실제로 된다 */
  fill?: boolean;
  /** 디바이스팜 「중지」. 지금 스텝을 마치고 멈춘다 */
  signal?: AbortSignal;
  /** 오류 스크린샷 폴더(실행마다 하위 폴더). 기록은 farm.db */
  resultsDir: string;
  log?: (line: string) => void;
}

interface Session {
  deps: ChaosDeps;
  driver: AndroidScreenDriver;
  stopGuard: () => Promise<void>;
  stopCollectors: () => Promise<void>;
  ring: LogRing;
  blocked: string[];
  relaunchedAt: number;
}

async function attach(deps: ChaosDeps, blocked: string[]): Promise<Omit<Session, "deps" | "relaunchedAt">> {
  const driver = await deps.openDriver();
  const stopGuard = await deps.guard(driver, (line) => blocked.push(line));
  const ring = new LogRing();
  const stopCollectors = await startCollectors(deps.device, deps.appId, driver, ring);
  return { driver, stopGuard, stopCollectors, ring, blocked };
}

async function detach(session: Session): Promise<void> {
  await session.stopCollectors().catch(() => undefined);
  await session.stopGuard().catch(() => undefined);
  await session.driver.close().catch(() => undefined);
}

const adb = (session: Session, ...args: string[]) => session.deps.exec("adb", ["-s", session.deps.device.id, "shell", ...args]);

async function launchApp(session: Session): Promise<void> {
  await adb(session, "monkey", "-p", session.deps.appId, "1");
}

/** 맨 앞 앱의 패키지. 못 읽으면 null */
export function parseForegroundPackage(dumpsys: string): string | null {
  return /topResumedActivity=ActivityRecord\{\S+ \S+ ([^/\s]+)\//.exec(dumpsys)?.[1] ?? null;
}

async function foregroundPackage(session: Session): Promise<string | null> {
  return parseForegroundPackage(await adb(session, "dumpsys", "activity", "activities").catch(() => ""));
}

/**
 * 대상 앱으로 돌아온다. 광고가 다른 앱을 열면 WebView를 못 찾고 실행 전체가 끝났다.
 * 앞으로 다시 띄워 보고, 그래도 화면을 못 읽으면 재시작한다.
 */
async function returnToApp(session: Session): Promise<void> {
  await launchApp(session);
  await sleep(settleMs);
  const readable = await session.driver.currentPath().then(() => true, () => false);
  if (!readable) await restartApp(session);
}

type Target = { role: "button" | "link"; name: string; to?: string };
type Input = { name: string; numeric: boolean };

/** 링크 이름(탐색 목록과 같은 규칙) → 도착 경로. 같은 출처 링크만 */
const linkTargetsScript = `(() => {
  const nameOf = (el) => (el.getAttribute("aria-label") || el.innerText || el.title || "").replace(/\\s+/g, " ").trim();
  return Array.from(document.querySelectorAll("a[href]")).flatMap((el) => {
    try {
      const url = new URL(el.href);
      return url.origin === location.origin ? [[nameOf(el), url.pathname]] : [];
    } catch (error) {
      return [];
    }
  });
})()`;

const dialogCountScript = `document.querySelectorAll('[role="dialog"], [aria-modal="true"]').length`;

/** 지금 화면: 경로와 누를 수 있는 요소(금지어·광고 제외) */
async function readScreen(driver: ScreenDriver): Promise<{ path: string; targets: Target[]; inputs: Input[]; state: string; fingerprint: string }> {
  const path = await driver.currentPath();
  const all = await driver.evaluate<{ role: string; name: string; pressable?: boolean; numeric?: boolean }[]>(listActionsScript).catch(() => []);
  // 가려지지 않은 입력칸. 같은 이름은 하나만
  const inputs = [...new Map(all.filter((item) => item.role === "input" && item.pressable !== false).map((item) => [item.name, { name: item.name, numeric: item.numeric === true }])).values()];
  // 같은 이름이 여럿이면(스택 아래·위 화면) 하나라도 누를 수 있으면 후보다
  const pressableKeys = new Set(all.filter((item) => item.pressable !== false).map((item) => `${item.role}:${item.name}`));
  const seen = new Set<string>();
  const targets: Target[] = [];
  for (const item of all) {
    if (item.role === "input" || hasForbiddenWord(item.name, driver.app.guard.forbiddenButtonWords) || isAvoidedName(item.name, driver.app.guard.avoidedNamePattern)) continue;
    const key = `${item.role}:${item.name}`;
    // 딤·팝업·떠 있는 광고에 가려진 요소는 고르지 않는다. 골라도 탭이 막혀 「멈춤」으로 재시작만 했다(2026-11-11 시드 11201)
    if (!pressableKeys.has(key)) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push({ role: item.role as Target["role"], name: item.name });
  }
  const text = await driver.evaluate<string>("(document.body ? document.body.innerText : '').replace(/\\s+/g, ' ')").catch(() => "");
  const dialogs = await driver.evaluate<number>(dialogCountScript).catch(() => 0);
  const hrefs = new Map(await driver.evaluate<[string, string][]>(linkTargetsScript).catch(() => []));
  for (const target of targets) if (target.role === "link" && hrefs.has(target.name)) target.to = hrefs.get(target.name);
  // 상태는 경로와 열린 팝업 수로만 본다. 버튼 이름까지 넣으면 키패드 숫자·실시간 값만 바뀌어도 새 상태가 됐다.
  return { path, targets, inputs, state: `${path}|팝업 ${dialogs}`, fingerprint: `${path}|${text.length}|${text.slice(0, 200)}` };
}

async function pressBack(session: Session, targets: readonly Target[]): Promise<void> {
  const inPage = targets.find((target) => session.driver.app.inPageBackNames.includes(target.name));
  if (inPage) return session.driver.clickButton(inPage.name, inPage.role);
  await adb(session, "input", "keyevent", "KEYCODE_BACK");
}

/** 행동 하나. 재시작은 드라이버를 새로 열어 session을 바꾼다. */
async function perform(session: Session, action: ChaosAction, targets: readonly Target[], random: () => number): Promise<void> {
  const { driver } = session;
  if (action.kind === "press") return driver.clickButton(action.name ?? "", action.role);
  if (action.kind === "fill") {
    await driver.evaluate(fillScript(action.name ?? "", action.value ?? ""));
    return;
  }
  if (action.kind === "tab") {
    const tabs = targets.filter((target) => target.role === "link" && isTabName(driver.app, target.name));
    const tab = tabs[Math.floor(random() * tabs.length)];
    action.role = tab.role;
    action.name = tab.name;
    return driver.clickButton(tab.name, tab.role);
  }
  if (action.kind === "back") return pressBack(session, targets);
  if (action.kind === "homeReset") return driver.goHome?.();
  if (action.kind === "doubleTap") {
    for (let i = 0; i < doubleTapCount; i += 1) await driver.clickButton(action.name ?? "", action.role);
    return;
  }
  if (action.kind === "backDuringLoad") {
    const pressable = targets.filter((target) => !driver.app.inPageBackNames.includes(target.name));
    const target = pressable[Math.floor(random() * pressable.length)];
    action.role = target.role;
    action.name = target.name;
    await driver.clickButton(target.name, target.role);
    await sleep(backDuringLoadMs);
    return pressBack(session, []);
  }
  if (action.kind === "background" || action.kind === "otherApp") {
    if (action.kind === "background") await adb(session, "input", "keyevent", "KEYCODE_HOME");
    else await adb(session, ...otherAppIntent);
    await sleep(backgroundMs);
    await launchApp(session);
    session.relaunchedAt = Date.now();
    return;
  }
  return restartApp(session);
}

/** 강제 종료 → 다시 열기 → CDP·가드·로그를 다시 붙인다(재시작하면 WebView 프로세스가 바뀌어 CDP 연결이 끊긴다). */
async function restartApp(session: Session): Promise<void> {
  await adb(session, "am", "force-stop", session.deps.appId);
  await detach(session);
  await launchApp(session);
  await sleep(restartWaitMs);
  Object.assign(session, await attach(session.deps, session.blocked));
  session.relaunchedAt = Date.now();
}

const firstLine = (error: unknown) => (error instanceof Error ? error.message.split("\n")[0] : String(error));

/**
 * 회차 시작. 홈으로 간 뒤 deep이 있으면 그 화면을 딥링크로 연다(홈이 스택 바닥에 남아 뒤로가 앱을 닫지 않는다).
 * 홈 이동이 실패하면 앱을 재시작해 한 번 더 한다. 그래도 안 되면 지금 화면에서 시작한다(실행을 멈추지 않는다). 깊은 화면을 못 열면 홈에서 한다.
 */
async function startEpisode(session: Session, log: (line: string) => void, deep?: string): Promise<void> {
  try {
    await session.driver.goHome?.();
  } catch (error) {
    log(`홈 이동 실패, 앱 재시작: ${firstLine(error)}`);
    await restartApp(session);
    await session.driver.goHome?.().catch((retryError: unknown) => log(`재시작 뒤에도 홈 이동 실패: ${firstLine(retryError)}`));
  }
  if (!deep) return;
  await session.driver.navigate(deep).then(
    () => log(`깊은 화면에서 시작: ${deep}`),
    async (error: unknown) => {
      log(`깊은 화면 ${deep} 열기 실패, 홈에서 시작: ${firstLine(error)}`);
      await session.driver.goHome?.().catch(() => undefined);
    },
  );
}

function describe(action: ChaosAction): string {
  return action.name ? `${action.kind} 「${action.name}」` : action.kind;
}

function bumpStats(stats: Map<string, ActionStats>, key: string, outcome: { newState: boolean; dead: boolean; stayed: boolean; errors: number }): void {
  const current = stats.get(key) ?? { tries: 0, openedNew: false, errors: 0, dead: 0, stayed: 0 };
  stats.set(key, {
    tries: current.tries + 1,
    openedNew: current.openedNew || outcome.newState,
    errors: current.errors + outcome.errors,
    dead: current.dead + (outcome.dead ? 1 : 0),
    stayed: (current.stayed ?? 0) + (outcome.stayed ? 1 : 0),
  });
}

/** 화면이 비어 있는 동안(로딩 중 흰 화면) `blankWaitMs`까지 기다린다 */
async function waitWhileBlank(driver: ScreenDriver): Promise<void> {
  const deadline = Date.now() + blankWaitMs;
  while (Date.now() < deadline && (await driver.evaluate<boolean>(isBlankScript).catch(() => false))) await sleep(blankPollMs);
}

/**
 * 다른 앱(광고·뉴스가 연 브라우저 등)에서 앱으로 돌아온 뒤 흰 화면이 남았는가. 비어 있는 동안 blankWaitMs까지 기다린 뒤 본다.
 * 돌아온 화면은 다음 스텝에서야 읽어 판정이 없었다(2026-11-17).
 */
async function blankAfterReturn(session: Session, from: string): Promise<Issue | null> {
  await waitWhileBlank(session.driver);
  const blank = await session.driver.evaluate<boolean>(isBlankScript).catch(() => false);
  if (!blank) return null;
  const path = await session.driver.currentPath().catch(() => "(읽기 실패)");
  return { kind: "blank", message: `${path} 빈 화면: ${from}에서 돌아온 뒤 글자와 이미지가 없습니다.` };
}

/** 지금 화면의 화면 깨짐 점검 실패를 봇 오류로. 화면 경로를 앞에 붙여 같은 문제는 한 번만 센다(dedupeErrors) */
async function layoutIssuesOf(session: Session, screenPath: string): Promise<Issue[]> {
  const checks = await checkLayout(session.driver, screenPath);
  return checks.filter((check) => !check.ok).map((check) => ({ kind: "layout", message: `${screenPath} ${check.title} — ${check.message ?? ""}` }));
}

async function saveScreenshot(session: Session, dir: string, name: string): Promise<string | undefined> {
  const png = await session.driver.screenshot().catch(() => null);
  if (!png) return undefined;
  writeFileSync(path.join(dir, name), png);
  return name;
}

export async function runChaos(deps: ChaosDeps): Promise<ChaosRun> {
  const log = deps.log ?? (() => undefined);
  const random = seededRandom(deps.seed);
  const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-s${deps.seed}`;
  const dir = path.join(deps.resultsDir, runId);
  mkdirSync(dir, { recursive: true });
  const run: ChaosRun = { runId, deviceId: deps.device.id, seed: deps.seed, startedAt: new Date().toISOString(), finishedAt: null, steps: [], states: 0, blocked: [] };
  // 기록은 farm.db에, 오류 스크린샷만 실행 폴더에 둔다
  const save = () => writeChaosRun(run);
  // 시작하자마자 남긴다. 첫 스텝까지(연결·홈 이동) 수십 초 걸려 그동안 진행 중 플로팅에 안 보였다(2026-11-17)
  save();
  const blocked: string[] = [];
  let attached: Awaited<ReturnType<typeof attach>>;
  try {
    attached = await attach(deps, blocked);
  } catch (error) {
    // 연결하지 못하면 끝난 것으로 닫는다. 안 닫으면 플로팅에 진행 중으로 계속 남는다
    run.finishedAt = new Date().toISOString();
    save();
    throw error;
  }
  const session: Session = { deps, relaunchedAt: 0, ...attached };
  const stats = new Map<string, ActionStats>();
  const seenStates = new Set<string>();
  const visitedPaths = new Set<string>();
  const seenErrors = new Set<string>();
  let failuresInRow = 0;
  let blockedAtPreviousStep = 0;
  const deadline = Date.now() + deps.minutes * 60_000;
  const going = () => Date.now() < deadline && !deps.signal?.aborted;

  try {
    for (let episode = 1; episode <= deps.episodes && going(); episode += 1) {
      // 첫 회차는 홈에서(홈 주변 점검), 다음 회차는 이번 실행에서 아직 안 간 깊은 화면에서
      const deep = episode > 1 ? pickStartPath(deps.startPaths ?? [], (path) => visitedPaths.has(path), random) : undefined;
      await startEpisode(session, log, deep);
      let lastPressed: Target | undefined;
      let stay = 0;
      let lastPath = "";
      for (let step = 1; step <= deps.stepsPerEpisode && going(); step += 1) {
        const before = await readScreen(session.driver).catch(async (error: unknown) => {
          log(`화면 읽기 실패, 앱으로 복귀: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
          await returnToApp(session);
          return readScreen(session.driver);
        });
        seenStates.add(before.state);
        visitedPaths.add(before.path);
        stay = before.path === lastPath ? stay + 1 : 0;
        lastPath = before.path;
        const nav = { ...session.driver.app, noPressPathPattern: session.driver.app.guard.noPressPathPattern };
        const scored = scoreAll(chaosCandidates({ path: before.path, targets: before.targets, inputs: deps.fill === false ? [] : before.inputs, lastPressed, nav }), (key) => stats.get(key), before.path, stay, (path) => visitedPaths.has(path));
        const chosen: ScoredAction = pickWeighted(scored, random);
        const key = actionKey(chosen.action);
        const recordKey = statsKey(before.path, chosen.action);
        // 실행이 대상을 정하는 행동(로딩 중 뒤로)은 복사본에 적는다. 점수 기록은 후보 키로 한다.
        const action: ChaosAction = { ...chosen.action };
        const since = Date.now();
        // 가드 차단 기록이 콘솔 오류보다 늦게 붙을 때가 있어 앞 스텝 시작부터 센다(푸시 토큰 오류 오탐)
        const blockedBefore = blockedAtPreviousStep;
        blockedAtPreviousStep = blocked.length;
        let failure: string | undefined;
        try {
          await perform(session, action, before.targets, random);
        } catch (error) {
          failure = error instanceof Error ? error.message.split("\n")[0] : String(error);
        }
        await sleep(settleMs);
        const foreground = await foregroundPackage(session);
        const leftApp = foreground && foreground !== deps.appId ? foreground : undefined;
        if (!leftApp) await waitWhileBlank(session.driver);
        const after = leftApp
          ? { ...before, path: `(다른 앱 ${leftApp})`, state: `(다른 앱 ${leftApp})`, fingerprint: "" }
          : await readScreen(session.driver).catch(() => ({ ...before, path: "(읽기 실패)", state: "(읽기 실패)", fingerprint: "" }));
        const newState = !seenStates.has(after.state);
        seenStates.add(after.state);
        const dead = action.kind === "press" && !failure && after.fingerprint === before.fingerprint;
        const issues: Issue[] = await probeScreen(session.driver, session.ring, since, deps.allowlist).catch(() => []);
        // 처음 본 화면 상태만 배치를 잰다 — 같은 상태를 다시 재면 시간만 든다
        if (newState && !leftApp) issues.push(...(await layoutIssuesOf(session, after.path)));
        // 앱 밖에 다녀온 뒤 빈 화면은 어디서 돌아왔는지 붙인다(다른 원인과 따로 묶인다)
        if (returnKinds.includes(action.kind)) {
          for (const issue of issues) if (issue.kind === "blank") issue.message = `${after.path} 빈 화면: ${action.kind === "otherApp" ? "다른 앱" : "백그라운드"}에서 돌아온 뒤 글자와 이미지가 없습니다.`;
        }
        const { errors, warnings } = dedupeErrors(judgeIssues(issues, { sinceRelaunchMs: Date.now() - session.relaunchedAt, guardBlocked: blocked.length > blockedBefore }), seenErrors);
        const stayed = action.kind === "press" && !failure && !dead && after.path === before.path;
        bumpStats(stats, recordKey, { newState, dead, stayed, errors: errors.length });
        if (action.kind === "press") lastPressed = { role: action.role ?? "button", name: action.name ?? "" };
        const record: ChaosStep = {
          episode,
          step,
          at: new Date().toISOString(),
          from: before.path,
          state: before.state,
          candidates: [...scored].sort((a, b) => b.score - a.score).slice(0, recordedCandidates).map((item) => ({ key: actionKey(item.action), score: Number(item.score.toFixed(3)), probability: Number(item.probability.toFixed(3)) })),
          chosen: action.name ? `${key}${chosen.action.name ? "" : action.name}` : key,
          chosenProbability: Number(chosen.probability.toFixed(3)),
          to: after.path,
          newState,
          dead,
          errors,
          warnings,
          ...(failure ? { failure } : {}),
          ...(leftApp ? { leftApp } : {}),
        };
        if (leftApp) {
          await returnToApp(session);
          const blank = await blankAfterReturn(session, `다른 앱 ${leftApp}`);
          if (blank) record.errors.push(...dedupeErrors({ errors: [blank], warnings: [] }, seenErrors).errors);
        }
        failuresInRow = failure ? failuresInRow + 1 : 0;
        if (failuresInRow >= stuckAfterFailures) {
          record.errors.push({ kind: "stuck", message: `${before.path}에서 행동 ${failuresInRow}번이 연달아 실패했습니다(마지막: ${failure}). 앱을 재시작합니다.` });
        }
        // 오류이거나 「가려져 못 누름」이면 무엇이 덮었는지 볼 수 있게 화면을 남긴다
        if (record.errors.length > 0 || failure?.includes("가려져")) record.screenshot = await saveScreenshot(session, dir, `e${episode}-s${step}.png`);
        run.steps.push(record);
        run.states = seenStates.size;
        run.blocked = [...blocked];
        save();
        if (failuresInRow >= stuckAfterFailures) {
          failuresInRow = 0;
          await restartApp(session);
          await startEpisode(session, log);
        }
        log(`[${episode}-${step}] ${before.path} → ${describe(action)} (${(chosen.probability * 100).toFixed(0)}%) → ${after.path}${newState ? " 새 상태" : ""}${dead ? " 반응 없음" : ""}${failure ? ` 실패: ${failure}` : ""}${errors.length ? ` 오류: ${errors.map((e) => e.kind).join(",")}` : ""}`);
      }
    }
  } finally {
    run.finishedAt = new Date().toISOString();
    save();
    await detach(session);
  }
  return run;
}

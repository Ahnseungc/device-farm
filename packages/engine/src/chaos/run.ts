import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { actionKey, chaosCandidates, statsKey, isAvoidedName, pickWeighted, scoreAll, seededRandom, type ActionStats, type ChaosAction, type ScoredAction } from "@device-farm/core/chaos/policy";
import { dedupeErrors, judgeIssues } from "@device-farm/core/chaos/judge";
import type { ChaosRun, ChaosStep } from "@device-farm/core/chaos/types";
import type { ScreenDriver } from "@device-farm/core/device/driver";
import type { Device } from "@device-farm/core/device/types";
import { hasForbiddenWord, listActionsScript } from "@device-farm/core/explore/actions";
import type { Allowlist } from "@device-farm/core/explore/policy";
import { probeScreen } from "@device-farm/core/explore/probe";
import { LogRing } from "@device-farm/core/logs/ring";
import { sleep } from "@device-farm/core/sleep";
import type { AndroidScreenDriver } from "@device-farm/devices/android-driver";
import type { Exec } from "@device-farm/devices/exec";
import { startCollectors } from "@device-farm/devices/logs/collect";

/**
 * 카오스 탐색 실행기(docs/design-chaos.md). 홈에서 회차를 시작해 정책이 고른 행동을 하고, 스텝마다 판정해 기록한다.
 * 첫 버전: 입력 경계값·네트워크 끊김·재현 경로 줄이기는 아직 없다.
 */

/** 행동 뒤 화면을 읽기까지 (작성자 판단, 버튼 눌러보기 settleMs와 같다) */
const settleMs = 1_500;
/** 로딩 중 뒤로: 누르고 뒤로 키까지 (설계 문서) */
const backDuringLoadMs = 300;
/** 백그라운드에 두는 시간 (설계 문서) */
const backgroundMs = 3_000;
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
async function readScreen(driver: ScreenDriver): Promise<{ path: string; targets: Target[]; state: string; fingerprint: string }> {
  const path = await driver.currentPath();
  const all = await driver.evaluate<{ role: string; name: string }[]>(listActionsScript).catch(() => []);
  const seen = new Set<string>();
  const targets: Target[] = [];
  for (const item of all) {
    if (item.role === "input" || hasForbiddenWord(item.name, driver.app.guard.forbiddenButtonWords) || isAvoidedName(item.name, driver.app.guard.avoidedNamePattern)) continue;
    const key = `${item.role}:${item.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push({ role: item.role as Target["role"], name: item.name });
  }
  const text = await driver.evaluate<string>("(document.body ? document.body.innerText : '').replace(/\\s+/g, ' ')").catch(() => "");
  const dialogs = await driver.evaluate<number>(dialogCountScript).catch(() => 0);
  const hrefs = new Map(await driver.evaluate<[string, string][]>(linkTargetsScript).catch(() => []));
  for (const target of targets) if (target.role === "link" && hrefs.has(target.name)) target.to = hrefs.get(target.name);
  // 상태는 경로와 열린 팝업 수로만 본다. 버튼 이름까지 넣으면 키패드 숫자·실시간 값만 바뀌어도 새 상태가 됐다.
  return { path, targets, state: `${path}|팝업 ${dialogs}`, fingerprint: `${path}|${text.length}|${text.slice(0, 200)}` };
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
  if (action.kind === "tab") {
    const tabNames = Object.keys(driver.app.tabPaths);
    const tabs = targets.filter((target) => target.role === "link" && tabNames.includes(target.name));
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
  if (action.kind === "background") {
    await adb(session, "input", "keyevent", "KEYCODE_HOME");
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

/** 회차 시작. 홈 이동이 실패하면 앱을 재시작해 한 번 더 한다. 그래도 안 되면 지금 화면에서 시작한다(실행을 멈추지 않는다). */
async function startEpisode(session: Session, log: (line: string) => void): Promise<void> {
  try {
    await session.driver.goHome?.();
    return;
  } catch (error) {
    log(`홈 이동 실패, 앱 재시작: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
  }
  await restartApp(session);
  await session.driver.goHome?.().catch((error: unknown) => log(`재시작 뒤에도 홈 이동 실패: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`));
}

function describe(action: ChaosAction): string {
  return action.name ? `${action.kind} 「${action.name}」` : action.kind;
}

function bumpStats(stats: Map<string, ActionStats>, key: string, outcome: { newState: boolean; dead: boolean; errors: number }): void {
  const current = stats.get(key) ?? { tries: 0, openedNew: false, errors: 0, dead: 0 };
  stats.set(key, {
    tries: current.tries + 1,
    openedNew: current.openedNew || outcome.newState,
    errors: current.errors + outcome.errors,
    dead: current.dead + (outcome.dead ? 1 : 0),
  });
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
  const save = () => writeFileSync(path.join(dir, "run.json"), `${JSON.stringify(run, null, 2)}\n`);
  const blocked: string[] = [];
  const session: Session = { deps, relaunchedAt: 0, ...(await attach(deps, blocked)) };
  const stats = new Map<string, ActionStats>();
  const seenStates = new Set<string>();
  const visitedPaths = new Set<string>();
  const seenErrors = new Set<string>();
  let failuresInRow = 0;
  let blockedAtPreviousStep = 0;
  const deadline = Date.now() + deps.minutes * 60_000;

  try {
    for (let episode = 1; episode <= deps.episodes && Date.now() < deadline; episode += 1) {
      await startEpisode(session, log);
      let lastPressed: Target | undefined;
      let stay = 0;
      let lastPath = "";
      for (let step = 1; step <= deps.stepsPerEpisode && Date.now() < deadline; step += 1) {
        const before = await readScreen(session.driver).catch(async (error: unknown) => {
          log(`화면 읽기 실패, 앱으로 복귀: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
          await returnToApp(session);
          return readScreen(session.driver);
        });
        seenStates.add(before.state);
        visitedPaths.add(before.path);
        stay = before.path === lastPath ? stay + 1 : 0;
        lastPath = before.path;
        const scored = scoreAll(chaosCandidates({ path: before.path, targets: before.targets, lastPressed, nav: { ...session.driver.app, noPressPathPattern: session.driver.app.guard.noPressPathPattern } }), (key) => stats.get(key), before.path, stay, (path) => visitedPaths.has(path));
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
        const after = leftApp
          ? { ...before, path: `(다른 앱 ${leftApp})`, state: `(다른 앱 ${leftApp})`, fingerprint: "" }
          : await readScreen(session.driver).catch(() => ({ ...before, path: "(읽기 실패)", state: "(읽기 실패)", fingerprint: "" }));
        const newState = !seenStates.has(after.state);
        seenStates.add(after.state);
        const dead = action.kind === "press" && !failure && after.fingerprint === before.fingerprint;
        const issues = await probeScreen(session.driver, session.ring, since, deps.allowlist).catch(() => []);
        const { errors, warnings } = dedupeErrors(judgeIssues(issues, { sinceRelaunchMs: Date.now() - session.relaunchedAt, guardBlocked: blocked.length > blockedBefore }), seenErrors);
        bumpStats(stats, recordKey, { newState, dead, errors: errors.length });
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
        failuresInRow = failure ? failuresInRow + 1 : 0;
        if (failuresInRow >= stuckAfterFailures) {
          record.errors.push({ kind: "stuck", message: `${before.path}에서 행동 ${failuresInRow}번이 연달아 실패했습니다(마지막: ${failure}). 앱을 재시작합니다.` });
        }
        if (record.errors.length > 0) record.screenshot = await saveScreenshot(session, dir, `e${episode}-s${step}.png`);
        run.steps.push(record);
        run.states = seenStates.size;
        run.blocked = [...blocked];
        save();
        if (failuresInRow >= stuckAfterFailures) {
          failuresInRow = 0;
          await restartApp(session);
          await startEpisode(session, log);
        } else if (leftApp) {
          await returnToApp(session);
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

import { sleep } from "../sleep";
import type { IntroScreen } from "../config/app-config";
import type { ScreenDriver } from "../device/driver";
import { listActionsScript, type ActionCandidate } from "../explore/actions";
import { waitForScreen as defaultWaitForScreen, samePath, type ScreenReady } from "../device/screen-ready";
import { fillScript } from "./fill";
import { readState, tapLine } from "./tap-trace";
import { stepLabels, stepTarget, type ClickTarget, type FlowDocument, type FlowStep } from "./schema";

/** 버튼·문구 하나를 기다리는 시간(작성자 판단, 포털 clickWaitMs와 같다). */
export const flowStepWaitMs = 10_000;
/** 누른 뒤 다음 스텝 전까지 기다리는 시간 (작성자 판단) */
export const clickSettleMs = 2_000;
/** 광고를 닫은 뒤 잔액이 늘 때까지 기다리는 시간 (작성자 판단). 적립 API·헤더로 날아가는 연출이 끝나야 숫자가 바뀐다 */
export const adRewardWaitMs = 20_000;

/** 광고 보기 전 잔액을 다시 읽는 횟수·간격 (작성자 판단) */
const balanceReadAttempts = 5;
const balanceReadRetryMs = 1_000;

/** 계정 상태 때문에 그 스텝을 점검할 수 없을 때. 「점검 못 함」으로 분류된다(infra-error.ts) */
export const accountStatePrefix = "계정 상태 때문에 점검할 수 없습니다: ";
export const accountStateMessage = (why: string) => `${accountStatePrefix}${why}.`;
/** 잔액을 다시 읽는 간격 */
const balancePollMs = 1_000;

/** 화면 위쪽(높이 20% 안) 헤더의 잔액. pattern은 `AppConfig.ads.balancePattern`. 쉼표·공백은 무시. 없으면 null */
export const balanceScript = (pattern: string) => `(() => {
  const H = innerHeight;
  const pattern = new RegExp(${JSON.stringify(pattern)});
  // 숫자와 단위가 따로 된 태그일 수 있다. 합친 글자로 본다
  for (const el of document.querySelectorAll("body *")) {
    const text = String(el.innerText || "").replace(/[\\s,]/g, "");
    const found = pattern.exec(text);
    if (!found || found[1] === undefined || found[1] === "" || Number.isNaN(Number(found[1]))) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.bottom <= 0 || r.top > H * 0.2) continue;
    return Number(found[1]);
  }
  return null;
})()`;

/** 입력칸을 다시 찾는 간격·입력 뒤 쉬는 시간 (작성자 판단) */
const fillRetryMs = 500;

/** 플로우가 안내 버튼을 직접 누르면(안내 화면을 점검하는 플로우) 넘기지 않는다. 안내 화면은 `AppConfig.introScreens` */
function introsToPass(introScreens: readonly IntroScreen[], steps: readonly FlowStep[]): IntroScreen[] {
  const pressed = new Set(steps.flatMap((step) => (step.type === "click" ? [step.target.name] : [])));
  return introScreens.filter((intro) => !pressed.has(intro.button));
}

/** 누른 뒤 안내 화면에 있으면 넘기고 다음 화면이 그려질 때까지 기다린다 */
async function passIntro(driver: ScreenDriver, intros: readonly IntroScreen[], waitForScreen: WaitForScreen): Promise<void> {
  if (intros.length === 0) return;
  const path = await driver.currentPath().catch(() => "");
  const intro = intros.find((item) => samePath(item.path, path));
  if (!intro) return;
  await waitForScreen(driver, path).catch(() => undefined);
  await driver.clickButton(intro.button);
  await sleep(clickSettleMs);
}

/** seen: 버튼·링크를 못 찾아 멈췄을 때 그 화면에서 실제로 누를 수 있던 이름들(`button 충전하기`) */
export type FlowStepResult = { index: number; type: FlowStep["type"]; target: string; status: "passed" | "failed"; durationMs: number; seen?: string[] };
/** 누를 버튼·링크가 화면에 없을 때의 드라이버 문구(Android·iOS 같다) */
export const isTargetMissing = (message: string | undefined) => /(버튼|링크)를 찾지 못했습니다/.test(message ?? "");
/** 못 찾았을 때 남기는 이름 수 (작성자 판단) */
const maxSeen = 40;
export type FlowResult = { status: "passed" | "failed"; steps: FlowStepResult[]; message?: string };


type WaitForScreen = (driver: ScreenDriver, path: string) => Promise<ScreenReady>;

/** 「디자인 확인」 스텝: 지금 화면을 대조한다. 결과는 점검기가 따로 남기고, 어긋나도 플로우는 이어 간다 */
export type CheckDesign = (driver: ScreenDriver, index: number) => Promise<void>;

async function runStep(
  driver: ScreenDriver,
  step: FlowStep,
  waitMs: number,
  waitForScreen: WaitForScreen,
  checkDesign?: CheckDesign,
  index = 0,
  intros: readonly IntroScreen[] = [],
  rewardWaitMs = adRewardWaitMs,
): Promise<void> {
  if (step.type === "home") {
    if (!driver.goHome) throw new Error("이 드라이버는 홈 탭으로 갈 수 없습니다.");
    await driver.goHome();
    // 다 그려지기(hydration) 전에 누르면 버튼이 반응하지 않는다.
    const ready = await waitForScreen(driver, driver.app.homePath);
    if (!ready.ok) throw new Error(ready.message);
    return;
  }
  if (step.type === "relaunch") {
    if (!driver.relaunch) throw new Error("이 드라이버는 앱을 다시 켤 수 없습니다.");
    await driver.relaunch();
    // 다시 켠 첫 화면이 다 그려질 때까지. 앱 진입 배너는 그 위에 뜬다
    const ready = await waitForScreen(driver, await driver.currentPath());
    if (!ready.ok) throw new Error(ready.message);
    return;
  }
  if (step.type === "click") {
    // 앞 스텝이 화면을 바꿨으면 다 그려진 뒤 누른다. 막 열린 화면은 탭을 받지 않았다(팝업 「확인」 등).
    // 대기 실패는 무시한다: 누르기 자체가 버튼을 못 찾으면 그 스텝이 실패한다.
    // fast: 시간 제한 화면이라 대기 없이 바로 누르고 넘어간다
    if (step.fast) {
      await driver.clickButton(step.target.name, step.target.role, step.target.match);
      return;
    }
    await driver
      .currentPath()
      .then((path) => waitForScreen(driver, path))
      .catch(() => undefined);
    await driver.clickButton(step.target.name, step.target.role, step.target.match);
    // ponytail: 누른 뒤 화면이 반응할 시간을 고정으로 준다. 막 열린 화면(금액 입력 등)은 그려진 직후에도
    // 탭을 놓쳤다. 화면별 준비 신호가 생기면 그걸로 바꾼다.
    await sleep(clickSettleMs);
    await passIntro(driver, intros, waitForScreen);
    return;
  }
  if (step.type === "watchAd") return watchAd(driver, step.target, waitForScreen, step.reward === "screen" ? null : rewardWaitMs, step.fast === true);
  if (step.type === "fill") return fill(driver, step.label, step.value, waitMs);
  if (step.type === "design") {
    // 다 그려진 뒤 잰다. 대조기가 없으면(화면 만들기 미리보기 등) 건너뛴다
    await driver
      .currentPath()
      .then((path) => waitForScreen(driver, path))
      .catch(() => undefined);
    await checkDesign?.(driver, index);
    return;
  }
  return driver.expectText(step.text, waitMs);
}

/** 다시 불러온 뒤 잔액을 읽는 시간 (작성자 판단) */
const reloadReadMs = 5_000;

/** ms 동안 잔액이 before보다 커지기를 기다린다. 마지막으로 읽은 값(못 읽으면 before) */
async function waitIncrease(driver: ScreenDriver, before: number, ms: number): Promise<number> {
  const deadline = Date.now() + ms;
  let after = before;
  for (;;) {
    const read = await readBalance(driver);
    if (read !== null) after = read;
    if (after > before || Date.now() >= deadline) return after;
    await sleep(balancePollMs);
  }
}

const readBalance = (driver: ScreenDriver) => {
  const pattern = driver.app.ads?.balancePattern;
  return pattern ? driver.evaluate<number | null>(balanceScript(pattern)).catch(() => null) : Promise.resolve(null);
};

/**
 * 광고 보고 적립: 잔액을 읽고, 광고 버튼을 누르고, 광고를 끝까지 보고 닫은 뒤, 잔액이 늘었는지 본다.
 * 적립은 화면 문구가 아니라 숫자로 판정한다(연출 문구는 자주 바뀐다).
 */
/**
 * rewardWaitMs null: 잔액이 아닌 보상(reward screen) — 광고가 뜨면 보고 닫는다. 광고가 안 떠도 실패로 치지 않고, 확인은 뒤 「문구 확인」 스텝이 한다.
 * dev 앱은 광고를 띄우지 않고 바로 보상하기도 한다.
 */
async function watchAd(driver: ScreenDriver, target: ClickTarget, waitForScreen: WaitForScreen, rewardWaitMs: number | null, fast = false): Promise<void> {
  if (!driver.watchAd) throw new Error("이 기기에서는 광고를 볼 수 없습니다.");
  // fast: 시간 제한 화면이라 화면 대기 없이 바로 누른다
  if (!fast) {
    await driver
      .currentPath()
      .then((path) => waitForScreen(driver, path))
      .catch(() => undefined);
  }
  if (rewardWaitMs === null) {
    await driver.clickButton(target.name, target.role, target.match);
    await driver.watchAd();
    await sleep(clickSettleMs);
    return;
  }
  if (!driver.app.ads?.balancePattern) throw new Error("앱 설정에 ads.balancePattern이 없어 잔액을 읽을 수 없습니다(잔액이 아닌 보상이면 reward: \"screen\").");
  // 헤더 잔액은 화면이 다 그려진 뒤에도 조금 늦게 뜬다. 잠깐 다시 읽는다
  let before = await readBalance(driver);
  for (let attempt = 0; before === null && attempt < balanceReadAttempts; attempt += 1) {
    await sleep(balanceReadRetryMs);
    before = await readBalance(driver);
  }
  if (before === null) throw new Error("광고 보기 전 잔액을 화면 위쪽에서 찾지 못했습니다.");
  try {
    await driver.clickButton(target.name, target.role, target.match);
  } catch (error) {
    // 최소 적립량에 못 미치면 버튼이 꺼지고 안내가 덮는 앱이 있다. 앱이 맞으므로 실패가 아니라 점검 못 함이다
    const { disabledText } = driver.app.ads;
    if (disabledText && (await driver.hasText(disabledText).catch(() => false))) throw new Error(accountStateMessage(`최소 적립량에 못 미쳐 「${target.name}」를 누를 수 없습니다`));
    throw error;
  }
  const ad = await driver.watchAd();
  // 헤더 숫자는 적립 뒤 바로 안 바뀔 때가 있다.
  // 기다려도 그대로면 화면을 한 번 다시 불러 서버 잔액을 읽는다
  let after = await waitIncrease(driver, before, rewardWaitMs);
  if (after <= before) {
    await driver.evaluate("location.reload()").catch(() => undefined);
    await driver
      .currentPath()
      .then((path) => waitForScreen(driver, path))
      .catch(() => undefined);
    after = await waitIncrease(driver, before, reloadReadMs);
  }
  if (after <= before) {
    const how = ad.shown ? `광고(${ad.seconds}초)를 보고 ${ad.closedBy}` : "광고 화면이 뜨지 않았고";
    throw new Error(`${how} ${rewardWaitMs / 1000}초를 기다리고 화면을 다시 불러도 잔액이 늘지 않았습니다(${before} 그대로).`);
  }
  // 적립 연출(풀 오버레이)이 끝날 틈
  await sleep(clickSettleMs);
}

/** 입력칸이 그려질 때까지(바텀시트가 열리는 중) 다시 시도한다 */
async function fill(driver: ScreenDriver, label: string, value: string, waitMs: number): Promise<void> {
  const deadline = Date.now() + waitMs;
  while (!(await driver.evaluate<boolean>(fillScript(label, value)))) {
    if (Date.now() > deadline) throw new Error(`「${label}」 입력칸을 찾지 못했습니다.`);
    await sleep(fillRetryMs);
  }
  // 입력 뒤 화면이 다시 그려질(버튼이 켜질) 틈을 준다
  await sleep(fillRetryMs);
}

/** 점검기가 도는 스텝: 맨 앞에 홈에서 시작. 진행 패널·결과의 번호도 이 목록 기준이다. */
export function withHome(flow: FlowDocument): FlowStep[] {
  return [{ type: "home" }, ...flow.steps];
}

export interface RunFlowOptions {
  now?: () => number;
  waitMs?: number;
  waitForScreen?: WaitForScreen;
  /** 스텝을 시작할 때마다. 진행 패널이 지금 스텝을 보여 준다. */
  onStep?: (index: number) => void;
  /** 「디자인 확인」 스텝에서 부른다. 없으면 그 스텝은 아무것도 안 하고 통과 */
  checkDesign?: CheckDesign;
  /** 광고를 닫은 뒤 잔액이 늘기를 기다리는 시간. 기본 adRewardWaitMs */
  adRewardWaitMs?: number;
  /** 누르기 전후 화면·누른 자리·웹 화면 목록 한 줄씩. 실패 기록에 남긴다. 없으면 재지 않는다 */
  onTrace?: (line: string) => void;
}

/** 지금 화면에서 누를 수 있는 버튼·링크 이름. 못 읽으면 빈 목록 */
async function seenTargets(driver: ScreenDriver): Promise<string[]> {
  const found = await driver.evaluate<ActionCandidate[]>(listActionsScript).catch(() => []);
  if (!Array.isArray(found)) return [];
  return [...new Set(found.filter((item) => item.role !== "input" && item.name).map((item) => `${item.role} ${item.name.slice(0, 40)}`))].slice(0, maxSeen);
}

/** 멈춘 자리: 지금 화면·누른 자리·웹 화면 목록, 화면에 그려진 글자와 읽는 웹 화면이 다른지 */
async function traceFailure(driver: ScreenDriver, label: string, onTrace: (line: string) => void): Promise<void> {
  const state = await readState(driver);
  const tap = (await driver.tapTrace?.().catch(() => "")) ?? "";
  const mismatch = (await driver.screenMismatch?.().catch(() => "")) ?? "";
  onTrace([`${label} 실패한 자리: ${state ? `${state.path}(글자 ${state.text}·팝업 ${state.dialogs})` : "못 읽음"}`, tap, mismatch].filter(Boolean).join(" · "));
}

/** 확정 플로우 하나를 스텝 순서로. 한 스텝이 실패하면 거기서 멈추고 실패. 통과·실패는 LLM 없이 정한다. */
export async function runFlow(driver: ScreenDriver, flow: FlowDocument, options: RunFlowOptions = {}): Promise<FlowResult> {
  const { now = Date.now, waitMs = flowStepWaitMs, waitForScreen = (target, path) => defaultWaitForScreen(target, path), onStep, checkDesign, adRewardWaitMs: rewardWaitMs = adRewardWaitMs, onTrace } = options;
  const steps: FlowStepResult[] = [];
  const intros = introsToPass(driver.app.introScreens ?? [], flow.steps);
  for (const [index, step] of withHome(flow).entries()) {
    onStep?.(index);
    const started = now();
    const base = { index, type: step.type, target: stepTarget(step, driver.app.homeTabName) };
    const label = `${index + 1}단계 ${stepLabels[step.type]} 「${base.target}」`;
    // fast는 시간 제한 화면이라 재지 않는다
    const traced = onTrace !== undefined && step.type === "click" && !step.fast;
    const before = traced ? await readState(driver) : null;
    try {
      await runStep(driver, step, waitMs, waitForScreen, checkDesign, index, intros, rewardWaitMs);
      if (traced) onTrace(tapLine(label, before, await readState(driver), (await driver.tapTrace?.().catch(() => "")) ?? ""));
      steps.push({ ...base, status: "passed", durationMs: now() - started });
    } catch (error) {
      const missing = (step.type === "click" || step.type === "watchAd") && isTargetMissing(error instanceof Error ? error.message : String(error));
      const seen = missing ? await seenTargets(driver) : [];
      steps.push({ ...base, status: "failed", durationMs: now() - started, ...(seen.length > 0 ? { seen } : {}) });
      const reason = error instanceof Error ? error.message.split("\n")[0] : String(error);
      if (onTrace) await traceFailure(driver, label, onTrace);
      return { status: "failed", steps, message: `${label} 실패: ${reason}` };
    }
  }
  return { status: "passed", steps };
}

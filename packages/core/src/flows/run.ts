import { sleep } from "../sleep";
import type { IntroScreen } from "../config/app-config";
import type { ScreenDriver } from "../device/driver";
import { waitForScreen as defaultWaitForScreen, samePath, type ScreenReady } from "../device/screen-ready";
import { fillScript } from "./fill";
import { stepLabels, stepTarget, type FlowDocument, type FlowStep } from "./schema";

/** 버튼·문구 하나를 기다리는 시간(작성자 판단, 포털 clickWaitMs와 같다). */
export const flowStepWaitMs = 10_000;
/** 누른 뒤 다음 스텝 전까지 기다리는 시간 (작성자 판단) */
export const clickSettleMs = 2_000;
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

export type FlowStepResult = { index: number; type: FlowStep["type"]; target: string; status: "passed" | "failed"; durationMs: number };
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
): Promise<void> {
  if (step.type === "home") {
    if (!driver.goHome) throw new Error("이 드라이버는 홈 탭으로 갈 수 없습니다.");
    await driver.goHome();
    // 다 그려지기(hydration) 전에 누르면 버튼이 반응하지 않는다.
    const ready = await waitForScreen(driver, driver.app.homePath);
    if (!ready.ok) throw new Error(ready.message);
    return;
  }
  if (step.type === "click") {
    // 앞 스텝이 화면을 바꿨으면 다 그려진 뒤 누른다. 막 열린 화면은 탭을 받지 않았다(팝업 「확인」 등).
    // 대기 실패는 무시한다: 누르기 자체가 버튼을 못 찾으면 그 스텝이 실패한다.
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
}

/** 확정 플로우 하나를 스텝 순서로. 한 스텝이 실패하면 거기서 멈추고 실패. 통과·실패는 LLM 없이 정한다. */
export async function runFlow(driver: ScreenDriver, flow: FlowDocument, options: RunFlowOptions = {}): Promise<FlowResult> {
  const { now = Date.now, waitMs = flowStepWaitMs, waitForScreen = (target, path) => defaultWaitForScreen(target, path), onStep, checkDesign } = options;
  const steps: FlowStepResult[] = [];
  const intros = introsToPass(driver.app.introScreens ?? [], flow.steps);
  for (const [index, step] of withHome(flow).entries()) {
    onStep?.(index);
    const started = now();
    const base = { index, type: step.type, target: stepTarget(step, driver.app.homeTabName) };
    try {
      await runStep(driver, step, waitMs, waitForScreen, checkDesign, index, intros);
      steps.push({ ...base, status: "passed", durationMs: now() - started });
    } catch (error) {
      steps.push({ ...base, status: "failed", durationMs: now() - started });
      const reason = error instanceof Error ? error.message.split("\n")[0] : String(error);
      return { status: "failed", steps, message: `${index + 1}단계 ${stepLabels[step.type]} 「${base.target}」 실패: ${reason}` };
    }
  }
  return { status: "passed", steps };
}

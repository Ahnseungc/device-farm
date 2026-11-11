import { sleep } from "../sleep";
import type { ScreenDriver } from "../device/driver";
import { waitForScreen as defaultWaitForScreen, type ScreenReady } from "../device/screen-ready";
import { stepLabels, stepTarget, type FlowDocument, type FlowStep } from "./schema";

/** 버튼·문구 하나를 기다리는 시간(작성자 판단, 포털 clickWaitMs와 같다). */
export const flowStepWaitMs = 10_000;
/** 누른 뒤 다음 스텝 전까지 기다리는 시간 (작성자 판단) */
export const clickSettleMs = 2_000;

export type FlowStepResult = { index: number; type: FlowStep["type"]; target: string; status: "passed" | "failed"; durationMs: number };
export type FlowResult = { status: "passed" | "failed"; steps: FlowStepResult[]; message?: string };


type WaitForScreen = (driver: ScreenDriver, path: string) => Promise<ScreenReady>;

async function runStep(driver: ScreenDriver, step: FlowStep, waitMs: number, waitForScreen: WaitForScreen): Promise<void> {
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
    return;
  }
  return driver.expectText(step.text, waitMs);
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
}

/** 확정 플로우 하나를 스텝 순서로. 한 스텝이 실패하면 거기서 멈추고 실패. 통과·실패는 LLM 없이 정한다. */
export async function runFlow(driver: ScreenDriver, flow: FlowDocument, options: RunFlowOptions = {}): Promise<FlowResult> {
  const { now = Date.now, waitMs = flowStepWaitMs, waitForScreen = (target, path) => defaultWaitForScreen(target, path), onStep } = options;
  const steps: FlowStepResult[] = [];
  for (const [index, step] of withHome(flow).entries()) {
    onStep?.(index);
    const started = now();
    const base = { index, type: step.type, target: stepTarget(step, driver.app.homeTabName) };
    try {
      await runStep(driver, step, waitMs, waitForScreen);
      steps.push({ ...base, status: "passed", durationMs: now() - started });
    } catch (error) {
      steps.push({ ...base, status: "failed", durationMs: now() - started });
      const reason = error instanceof Error ? error.message.split("\n")[0] : String(error);
      return { status: "failed", steps, message: `${index + 1}단계 ${stepLabels[step.type]} 「${base.target}」 실패: ${reason}` };
    }
  }
  return { status: "passed", steps };
}

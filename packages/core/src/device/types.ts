export type Platform = "android" | "ios";
export type BuildKind = "dev" | "prod";
export type DeviceState = "idle" | "checking" | "controlling" | "offline";

export interface Device {
  id: string;
  platform: Platform;
  model: string;
  osVersion: string;
  appVersion: string | null;
}

import type { FlowStepResult } from "../flows/run";
import type { QaCheck } from "../qa/rules";
import type { ButtonResult } from "./button-check";

/** 진행 패널의 플로우 스텝 한 줄. 예: `누르기 「출석체크」` */
export type FlowStepView = { label: string; status: "passed" | "running" | "pending" };

export type ScreenStatus = "passed" | "failed" | "candidate" | "login_required";
/** `running`은 실행 중에만 보인다. 실행이 끝나면 나머지 여섯 중 하나가 된다. */
export type OutcomeStatus = "running" | "passed" | "failed" | "skipped" | "install_failed" | "login_required" | "offline";
export type RunTrigger = "manual" | "auto";

export interface DeviceScreen {
  scenario: string;
  status: ScreenStatus;
  message?: string;
  screenshot?: string;
  logDir?: string;
  /** 플로우 결과면 스텝별 통과 여부 */
  steps?: FlowStepResult[];
  /** 버튼 눌러보기를 켠 점검이면 버튼별 결과 */
  buttons?: ButtonResult[];
  /** 데이터 QA 결과면 규칙별 통과 여부 */
  checks?: QaCheck[];
}

/** 실행 중(`running`)일 때 지금 하는 일. 끝나면 지운다. */
export type OutcomePhase = "installing" | "waiting_testflight" | "checking";

export interface DeviceOutcome {
  device: Device;
  status: OutcomeStatus;
  message?: string;
  screens: DeviceScreen[];
  phase?: OutcomePhase;
  /** phase가 checking일 때 지금 보고 있는 시나리오 이름 */
  current?: string;
  /** 지금 도는 플로우의 스텝들. 플로우가 끝나면 지운다. */
  flowSteps?: FlowStepView[];
}

export interface DeviceRun {
  runId: string;
  kind: BuildKind;
  version: string;
  trigger: RunTrigger;
  startedAt: string;
  finishedAt: string | null;
  outcomes: DeviceOutcome[];
  /** 기기마다 돌 시나리오 수. 진행률 분모 */
  scenarioCount?: number;
}

export type LogSource = "console" | "network" | "system" | "crash";
export type LogEntry = { at: number; source: LogSource; text: string };

export const deviceConcurrency = 2;


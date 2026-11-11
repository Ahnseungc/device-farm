import type { DeviceOutcome, DeviceRun, OutcomeStatus, Platform } from "@device-farm/core/device/types";
import type { ExploreRun } from "@device-farm/core/explore/actions";

const platformLabels = { android: "Android", ios: "iOS" } as const satisfies Record<Platform, string>;

/** 스펙 출력 예의 "설치 완료"처럼 기기 줄 끝에 붙는 단계. */
const phaseLabels = {
  running: "점검 중",
  passed: "설치 완료",
  failed: "설치 완료",
  skipped: "건너뜀",
  install_failed: "설치 실패",
  login_required: "로그인 필요",
  offline: "연결 끊김",
} as const satisfies Record<OutcomeStatus, string>;

export const exitCodes = { ok: 0, failed: 1 } as const;
export type ExitCode = (typeof exitCodes)[keyof typeof exitCodes];

function deviceHeader(outcome: DeviceOutcome): string {
  const { device } = outcome;
  const name = device.model || device.id;
  const phase = outcome.message && outcome.status !== "passed" && outcome.status !== "failed"
    ? `${phaseLabels[outcome.status]} (${outcome.message})`
    : phaseLabels[outcome.status];
  return `[${name}] ${platformLabels[device.platform]} ${device.osVersion} · ${phase}`;
}

function failLine(outcome: DeviceOutcome): string {
  const screen = outcome.screens.find((item) => item.status === "failed");
  if (screen) return `FAIL ${screen.scenario} · ${screen.message ?? "기준 화면과 다릅니다"}`;
  return `FAIL ${outcome.message ?? "실패"}`;
}

function passLine(outcome: DeviceOutcome): string {
  const passed = outcome.screens.filter((item) => item.status === "passed").length;
  return `PASS ${passed}/${outcome.screens.length} 화면`;
}

/** 기기 하나의 출력 줄. passed·failed면 결과 줄이 붙는다. */
export function formatOutcome(outcome: DeviceOutcome): string[] {
  const header = deviceHeader(outcome);
  if (outcome.status === "passed") return [header, passLine(outcome)];
  if (outcome.status === "failed") return [header, failLine(outcome)];
  return [header];
}

/** 기기 id → 마지막으로 찍은 줄 묶음. 폴링 사이에 들고 다닌다. */
export type PrintedState = Map<string, string>;

/** 지난 폴링 이후 새로 생기거나 바뀐 기기 줄만 돌려준다. `printed`를 갱신한다. */
export function changedLines(run: DeviceRun, printed: PrintedState): string[] {
  const lines: string[] = [];
  for (const outcome of run.outcomes) {
    const current = formatOutcome(outcome);
    const key = current.join("\n");
    if (printed.get(outcome.device.id) === key) continue;
    printed.set(outcome.device.id, key);
    lines.push(...current);
  }
  return lines;
}

/** `failed`가 하나라도 있으면 1. install_failed·login_required·offline은 0 (스펙 "정하지 않은 것"). */
export const noDevicesMessage = "점검할 기기가 없습니다. 연결 상태를 확인해 주세요.";

/** 기기가 하나도 없으면 아무것도 점검하지 않은 것이라 실패로 본다. */
export function runExitCode(run: DeviceRun): ExitCode {
  if (run.outcomes.length === 0) return exitCodes.failed;
  return run.outcomes.some((outcome) => outcome.status === "failed") ? exitCodes.failed : exitCodes.ok;
}

export function isRunFinished(run: DeviceRun): boolean {
  return run.finishedAt !== null;
}

export interface ExploreSummary {
  issues: number;
  blocked: number;
}

export function summarizeExplore(runs: readonly ExploreRun[]): ExploreSummary {
  return {
    issues: runs.reduce((sum, run) => sum + run.issues.length, 0),
    blocked: runs.reduce((sum, run) => sum + run.blocked.length, 0),
  };
}

export function formatExploreSummary(summary: ExploreSummary): string {
  return `오류 ${summary.issues}개 · 차단 ${summary.blocked}개`;
}

export function formatExploreRun(run: ExploreRun): string {
  const state = run.finishedAt === null ? "탐색 중" : "탐색 완료";
  return `[${run.deviceId}] ${state} · ${formatExploreSummary(summarizeExplore([run]))} · 경로 ${run.paths.length}개`;
}

/** 오류가 하나라도 있으면 1. 차단만 있으면 0. */
export function exploreExitCode(runs: readonly ExploreRun[]): ExitCode {
  return summarizeExplore(runs).issues > 0 ? exitCodes.failed : exitCodes.ok;
}

/** 이 요청의 runId 실행이 하나 이상 있고 모두 끝났는지. */
export function isExploreFinished(runs: readonly ExploreRun[]): boolean {
  return runs.length > 0 && runs.every((run) => run.finishedAt !== null);
}

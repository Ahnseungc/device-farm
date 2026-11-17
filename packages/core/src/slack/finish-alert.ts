import type { ChaosRun } from "../chaos/types";
import type { ExploreRun } from "../explore/actions";
import type { DeviceRun, ScreenStatus } from "../device/types";

import { outcomeStatusLabels, plainError } from "./plain-error";

/**
 * 점검이 끝날 때마다 점검 알림 채널에 보내는 한 줄 요약(2026-11-16 요청: 모든 점검 끝나면 슬랙으로).
 * 실패·버그 후보 알림(failure-alert·policy-alert)과 따로, 문제가 없어도 「끝났다」를 남긴다.
 */

export interface FinishAlert {
  text: string;
  blocks: unknown[];
}

const minuteMs = 60_000;

/** 걸린 시간: 「12분」「1시간 5분」, 1분 안이면 「1분 미만」 */
export function durationLabel(startedAt: string, finishedAt: string): string {
  const minutes = Math.floor(
    (Date.parse(finishedAt) - Date.parse(startedAt)) / minuteMs,
  );
  if (!Number.isFinite(minutes) || minutes < 1) return "1분 미만";
  const hours = Math.floor(minutes / 60);
  return hours > 0
    ? `${hours}시간${minutes % 60 ? ` ${minutes % 60}분` : ""}`
    : `${minutes}분`;
}

const toAlert = (title: string, lines: readonly string[]): FinishAlert => ({
  text: title,
  blocks: [
    {
      type: "section",
      text: { type: "mrkdwn", text: [`*${title}*`, ...lines].join("\n") },
    },
  ],
});

const screenLabels: Record<ScreenStatus, string> = {
  passed: "통과",
  failed: "실패",
  candidate: "기준 후보",
  login_required: "로그인 필요",
};

export function deviceFinishAlert(run: DeviceRun): FinishAlert {
  const name = run.label ?? `${run.kind} ${run.version} 기기 점검`;
  const screens = run.outcomes.flatMap((outcome) => outcome.screens);
  const counts = (Object.keys(screenLabels) as ScreenStatus[]).flatMap(
    (status) => {
      const count = screens.filter((screen) => screen.status === status).length;
      return count > 0 ? [`${screenLabels[status]} ${count}`] : [];
    },
  );
  const failed =
    screens.some((screen) => screen.status === "failed") ||
    run.outcomes.some((outcome) => outcome.status !== "passed");
  const devices = run.outcomes.map(
    (outcome) =>
      `${outcome.device.model} ${outcome.status === "passed" ? "통과" : plainError(outcome.message) || (outcomeStatusLabels[outcome.status] ?? outcome.status)}`,
  );
  return toAlert(
    `${failed ? ":x:" : ":white_check_mark:"} ${name} 끝 · ${durationLabel(run.startedAt, run.finishedAt ?? run.startedAt)}`,
    [
      `${run.trigger === "auto" ? "자동" : "수동"} · 화면 ${screens.length}개${counts.length ? ` (${counts.join(" · ")})` : ""}`,
      ...devices.map((line) => `• ${line}`),
    ],
  );
}

export function botFinishAlert(
  run: ChaosRun,
  summary: string | null,
): FinishAlert {
  const errorSteps = run.steps.filter((step) => step.errors.length > 0).length;
  const screens = new Set(run.steps.flatMap((step) => [step.from, step.to]))
    .size;
  return toAlert(
    `${errorSteps > 0 ? ":warning:" : ":white_check_mark:"} 봇 점검 끝 · ${run.deviceId} · ${durationLabel(run.startedAt, run.finishedAt ?? run.startedAt)}`,
    [
      `스텝 ${run.steps.length} · 다닌 화면 ${screens}곳 · 오류 스텝 ${errorSteps} · 막은 쓰기 ${run.blocked.length}`,
      ...(summary ? [summary] : []),
    ],
  );
}

export function exploreFinishAlert(runs: readonly ExploreRun[]): FinishAlert {
  const issues = runs.reduce((sum, run) => sum + run.issues.length, 0);
  const paths = runs.reduce((sum, run) => sum + run.paths.length, 0);
  const started = runs.map((run) => run.startedAt).sort()[0];
  const finished = runs
    .map((run) => run.finishedAt ?? run.startedAt)
    .sort()
    .at(-1);
  return toAlert(
    `${issues > 0 ? ":warning:" : ":white_check_mark:"} 탐색 점검 끝${started && finished ? ` · ${durationLabel(started, finished)}` : ""}`,
    [`기기 ${runs.length}대 · 경로 ${paths}개 · 문제 ${issues}건`],
  );
}

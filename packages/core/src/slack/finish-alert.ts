import type { ChaosRun } from "../chaos/types";
import type { ExploreRun } from "../explore/actions";
import { diffMessage, sizeMessage } from "../baseline/diff";
import type { DeviceOutcome, DeviceRun, DeviceScreen } from "../device/types";

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

/** 끝 알림에 이름을 적는 실패 수 (작성자 판단). 넘으면 「외 N개」 */
export const maxFailedNames = 15;

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

/** 화면 수 줄에 쓰는 상태. 점검 못 함은 extraLines가 따로 쓴다 */
const countedStatuses = ["passed", "failed", "candidate", "login_required"] as const;
type CountedStatus = (typeof countedStatuses)[number];

const screenLabels: Record<CountedStatus, string> = {
  passed: "통과",
  failed: "실패",
  candidate: "기준 후보",
  login_required: "로그인 필요",
};

/** 다시 돌려 통과한 화면 메시지 머리. engine/retry.ts retriedMessage가 이것으로 만든다 */
export const retriedPassText = "다시 돌려 통과";

const isBaselineDiff = (screen: DeviceScreen) =>
  screen.status === "failed" && screen.message != null && (screen.message.startsWith(diffMessage) || screen.message.startsWith(sizeMessage));
const isAppFailure = (screen: DeviceScreen) => screen.status === "failed" && !isBaselineDiff(screen);
const isRetriedPass = (screen: DeviceScreen) => screen.status === "passed" && (screen.message?.startsWith(retriedPassText) ?? false);
/** 앱 실패 화면 없이 failed로 끝난 기기(드라이버 열기·다시 열기 실패) — 기기 쪽 문제다 */
const isDeviceTrouble = (outcome: DeviceOutcome) =>
  outcome.status === "offline" || outcome.status === "login_required" || (outcome.status === "failed" && !outcome.screens.some(isAppFailure));

/**
 * ❌: 앱 실패(기준 화면 차이 제외)나 설치 실패(빌드 문제일 수 있음). ⚠️: 기준 화면 차이·점검 못 함·기기 문제. 그 밖 ✅.
 * 기기 outcome은 기준 화면 차이도 failed로 쳐서 그대로 쓰지 않는다.
 */
export function finishEmoji(run: DeviceRun): ":x:" | ":warning:" | ":white_check_mark:" {
  const screens = run.outcomes.flatMap((outcome) => outcome.screens);
  if (screens.some(isAppFailure) || run.outcomes.some((outcome) => outcome.status === "install_failed")) return ":x:";
  const unsure = screens.some((screen) => isBaselineDiff(screen) || screen.status === "inconclusive");
  return unsure || run.outcomes.some(isDeviceTrouble) ? ":warning:" : ":white_check_mark:";
}

/** 화면 상태별 수. 실패는 앱 실패만 세고, 점검 못 함은 아래 따로 줄로 쓴다 */
function countsLine(screens: readonly DeviceScreen[]): string[] {
  const countOf: Record<CountedStatus, number> = {
    passed: screens.filter((screen) => screen.status === "passed").length,
    failed: screens.filter(isAppFailure).length,
    candidate: screens.filter((screen) => screen.status === "candidate").length,
    login_required: screens.filter((screen) => screen.status === "login_required").length,
  };
  return countedStatuses.flatMap((status) => (countOf[status] > 0 ? [`${screenLabels[status]} ${countOf[status]}`] : []));
}

function extraLines(screens: readonly DeviceScreen[]): string[] {
  const lines: [number, string][] = [
    [screens.filter((screen) => screen.status === "inconclusive").length, "점검 못 함 # (기기·연결)"],
    [screens.filter(isBaselineDiff).length, "화면 바뀜 # (기준 화면 탭에서 확인)"],
    [screens.filter(isRetriedPass).length, "다시 돌려 통과 #"],
  ];
  return lines.flatMap(([count, text]) => (count > 0 ? [text.replace("#", String(count))] : []));
}

export function deviceFinishAlert(run: DeviceRun): FinishAlert {
  const name = run.label ?? `${run.kind} ${run.version} 기기 점검`;
  const screens = run.outcomes.flatMap((outcome) => outcome.screens);
  const counts = countsLine(screens);
  const devices = run.outcomes.map(
    (outcome) =>
      `${outcome.device.model} ${outcome.status === "passed" ? "통과" : plainError(outcome.message) || (outcomeStatusLabels[outcome.status] ?? outcome.status)}`,
  );
  // 전에 알린 실패는 따로 알림이 안 가므로(같은 실패는 한 번만), 끝 알림에 이번 실패 이름을 모두 적는다. 기준 화면 차이는 「화면 바뀜」 줄로
  const failedNames = [...new Set(screens.filter(isAppFailure).map((screen) => screen.scenario))];
  const shown = failedNames.slice(0, maxFailedNames);
  return toAlert(
    `${finishEmoji(run)} ${name} 끝 · ${durationLabel(run.startedAt, run.finishedAt ?? run.startedAt)}`,
    [
      `${run.trigger === "auto" ? "자동" : "수동"} · 화면 ${screens.length}개${counts.length ? ` (${counts.join(" · ")})` : ""}`,
      ...extraLines(screens),
      ...devices.map((line) => `• ${line}`),
      ...(shown.length ? ["실패한 것:", ...shown.map((scenario) => `  – ${scenario}`)] : []),
      ...(failedNames.length > shown.length ? [`  – 외 ${failedNames.length - shown.length}개(디바이스팜 결과 탭)`] : []),
    ],
  );
}

/** 멈춘 점검에서 아직 안 돈 항목의 메시지. engine `stoppedMessage`가 이 값이다 */
export const stoppedText = "점검을 멈췄습니다.";

/** 점검 이름: 이름표가 없으면 `<kind> <version> 기기 점검` */
const runName = (run: DeviceRun) => run.label ?? `${run.kind} ${run.version} 기기 점검`;

/**
 * 기기 점검이 시작될 때 한 줄. 무엇이 몇 개, 어느 기기로 도는지.
 * 기기는 결과에 기기가 생긴 뒤에만 적는다(시작 직후엔 비어 있을 수 있다).
 */
export function deviceStartAlert(run: DeviceRun): FinishAlert {
  const devices = run.outcomes.map((outcome) => outcome.device.model);
  return toAlert(`:arrow_forward: ${runName(run)} 시작`, [
    `${run.trigger === "auto" ? "자동" : "수동"} · 항목 ${run.scenarioCount}개${devices.length ? ` · ${devices.join(", ")}` : ""}`,
  ]);
}

/**
 * QA 제보에 밀려 멈춘 점검. 「끝」으로 보내면 끝난 줄 안다. 남은 항목은 제보 점검 뒤 「(이어서)」로 돈다.
 */
export function devicePausedAlert(run: DeviceRun): FinishAlert {
  const done = run.outcomes.flatMap((outcome) => outcome.screens).filter((screen) => screen.message !== stoppedText).length;
  return toAlert(`:pause_button: ${runName(run)} 멈춤 · QA 제보 점검을 먼저 돌려요`, [
    `끝난 항목 ${done}개 · 남은 항목은 QA 제보 점검이 끝나면 「(이어서)」로 돌려요`,
  ]);
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

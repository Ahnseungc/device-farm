/**
 * 실패한 점검을 한 번 다시 돌릴지, 두 결과 중 무엇으로 확정할지.
 * 반목표 「애매하면 failed」: 두 번 중 한 번이라도 앱 실패면 failed다.
 */
import { diffMessage, sizeMessage } from "@device-farm/core/baseline/diff";
import { isFlowTimeout, isInfraFailure } from "@device-farm/core/device/infra-error";
import { stepLabels } from "@device-farm/core/flows/schema";
import type { ScreenStatus } from "@device-farm/core/device/types";
import { retriedPassText } from "@device-farm/core/slack/finish-alert";

export type Attempt = { status: ScreenStatus; message?: string };
export type Settled = Attempt & { from: "first" | "second" };

/** 망가진 빌드에서 점검이 두 배로 늘지 않게 (작성자 판단) */
export const maxRetriesPerDevice = 10;
/** 같은 기기에서 기기·연결 실패가 이만큼 연속 확정되면 남은 점검을 건너뛴다 */
export const infraStreakLimit = 3;

/**
 * 플로우 첫 단계 「홈에서 시작」 실패가 이만큼 연속되면 남은 플로우를 건너뛴다 (작성자 판단).
 * 홈으로 못 가면 뒤 플로우도 다 같은 곳에서 실패한다. 그 실패를 다시 돌리느라 시간도 오래 걸린다.
 */
export const homeStreakLimit = 3;

const homeFailurePrefix = `1단계 ${stepLabels.home} 「`;

/** 플로우가 첫 단계 「홈에서 시작」에서 실패했는가 */
export const isHomeStartFailure = (attempt: Attempt) => attempt.status !== "passed" && (attempt.message?.includes(homeFailurePrefix) ?? false);

/** 홈 실패 연속으로 남은 플로우를 건너뛸 때의 메시지. `server`는 앱 웹 서버 확인 결과(정상이면 null) */
export const homeSkipMessage = (server: string | null) =>
  server
    ? `앱 웹 서버가 정상 응답하지 않아(${server}) 남은 플로우를 건너뜀`
    : `앞 플로우 ${homeStreakLimit}개가 모두 1단계 「${stepLabels.home}」에서 실패해 남은 플로우를 건너뜀`;

/** 서버 탓 점검 못 함이 이만큼 이어지면(단계와 상관없이) 남은 플로우를 건너뛴다 (작성자 판단) */
export const serverStreakLimit = 3;
/** 점검을 시작할 때 서버가 정상이 되기를 기다리는 시간·간격. dev 배포가 보통 1~3분 걸린다 (작성자 판단) */
export const serverStartWaitMs = 300_000;
export const serverStartPollMs = 10_000;

/** 시작할 때 서버가 끝내 정상이 아니어서 점검을 시작하지 못한 항목의 메시지 */
export const serverNotReadyMessage = (server: string) => `앱 웹 서버가 정상 응답하지 않아(${server}) 점검을 시작하지 못함`;

/** 앱 웹 서버가 정상 응답하지 않을 때 실패에 붙이는 머리말. 이 실패는 점검 못 함이다 */
export const serverDownPrefix = (server: string) => `앱 웹 서버가 정상 응답하지 않음(${server}) · `;
export const isServerDown = (message: string | undefined) => message?.startsWith("앱 웹 서버가 정상 응답하지 않음(") ?? false;

const isBaselineDiff = (message: string | undefined) => message != null && (message.startsWith(diffMessage) || message.startsWith(sizeMessage));

export function shouldRetry(first: Attempt, options: { retryable: boolean }): boolean {
  if (first.status !== "failed" || !options.retryable) return false;
  return !isBaselineDiff(first.message) && !isFlowTimeout(first.message);
}

export function classify(attempt: Attempt): Attempt {
  if (attempt.status === "failed" && isInfraFailure(attempt.message)) return { ...attempt, status: "inconclusive" };
  return attempt;
}

export function retriedMessage(firstMessage: string | undefined): string {
  return `${retriedPassText} (첫 시도: ${firstMessage ?? "실패"})`;
}

export function settleRetry(first: Attempt, second: Attempt): Settled {
  if (second.status === "passed") return { status: "passed", message: retriedMessage(first.message), from: "second" };
  if (second.status !== "failed") return { ...second, from: "second" };
  if (!isInfraFailure(second.message)) return { ...second, from: "second" };
  const firstWasApp = first.status === "failed" && !isInfraFailure(first.message);
  if (firstWasApp) return { ...first, from: "first" };
  return { ...second, status: "inconclusive", from: "second" };
}

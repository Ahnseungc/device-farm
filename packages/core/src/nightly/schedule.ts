/**
 * 야간 자동 점검 일정. 시각은 서버 로컬 시간(KST 호스트).
 * 정책 바뀜 확인(02:00) 뒤에 플로우 점검, 그 뒤에 봇 점검.
 */

import { lastScheduledAt } from "../policy/schedule";

export type NightlyKind = "flows" | "bot";

export interface NightlySlot {
  kind: NightlyKind;
  hour: number;
  minute: number;
  /** 화면·로그에 쓰는 이름 */
  label: string;
}

export const nightlySlots: readonly NightlySlot[] = [
  { kind: "flows", hour: 3, minute: 0, label: "야간 플로우 점검" },
  { kind: "bot", hour: 3, minute: 30, label: "야간 봇 점검" },
];

/**
 * 예정 시각에서 이만큼 지나도 못 돌았으면 그날은 건너뛴다 (작성자 판단).
 * 서버가 낮에 켜졌을 때 사람이 기기를 쓰는 중에 야간 점검이 시작되지 않게 한다. 출근 전(08시)까지.
 */
export const nightlyWindowMs = 5 * 60 * 60_000;

/** 야간 봇 점검 한 기기 시간(분)·에피소드·에피소드당 스텝 (작성자 판단) */
export const nightlyBotMinutes = 30;
export const nightlyBotEpisodes = 20;
export const nightlyBotSteps = 50;

export type NightlyDecision = { action: "run"; scheduledAt: Date } | { action: "skip"; scheduledAt: Date } | { action: "wait" };

/**
 * 지금 이 칸을 어떻게 할지. `handledAt`은 마지막으로 처리(돌았거나 건너뜀)한 예정 시각.
 * - 가장 최근 예정 시각을 이미 처리했으면 기다린다.
 * - 아직이고 창 안이면 돈다. 창이 지났으면 건너뛴 것으로 남긴다.
 */
export function nightlyDecision(slot: NightlySlot, handledAt: string | null, now: Date): NightlyDecision {
  const scheduledAt = lastScheduledAt(now, slot.hour, slot.minute);
  const handled = handledAt ? Date.parse(handledAt) : Number.NaN;
  if (Number.isFinite(handled) && handled >= scheduledAt.getTime()) return { action: "wait" };
  return now.getTime() - scheduledAt.getTime() <= nightlyWindowMs ? { action: "run", scheduledAt } : { action: "skip", scheduledAt };
}

/** 날짜로 정하는 봇 시드(YYYYMMDD). 같은 날 다시 돌리면 같은 길을 간다 */
export function nightlySeed(scheduledAt: Date): number {
  return scheduledAt.getFullYear() * 10_000 + (scheduledAt.getMonth() + 1) * 100 + scheduledAt.getDate();
}

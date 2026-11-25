/**
 * 예약 점검 일정. 시각은 서버 로컬 시간(KST 호스트).
 * 정기 점검은 3시간마다(00·03·…·21시), 봇 점검은 03:30.
 */

import { lastScheduledAt } from "../policy/schedule";

export type NightlyKind = "regular" | "bot";

export interface NightlySlot {
  kind: NightlyKind;
  /** 하루 한 번인 칸의 시각. `everyHours`가 있으면 그 간격의 기준 시각 */
  hour: number;
  minute: number;
  /** 이 시간 간격으로 되풀이한다(24의 약수). 없으면 하루 한 번 */
  everyHours?: number;
  /** 화면·로그에 쓰는 이름 */
  label: string;
  /** 예정 시각에서 이만큼 지나면 그 칸은 건너뛴다. 없으면 nightlyWindowMs */
  windowMs?: number;
}

/** 정기 점검 간격(시간) */
export const regularEveryHours = 3;
/** 정기 점검 창. 이만큼 늦으면 다음 칸이 가까워 건너뛴다 (작성자 판단) */
const regularWindowMs = 2 * 60 * 60_000;

export const nightlySlots: readonly NightlySlot[] = [
  { kind: "regular", hour: 0, minute: 0, everyHours: regularEveryHours, label: "정기 점검", windowMs: regularWindowMs },
  { kind: "bot", hour: 3, minute: 30, label: "야간 봇 점검" },
];

/** 가장 최근 예정 시각 */
function lastSlotAt(slot: NightlySlot, now: Date): Date {
  if (!slot.everyHours) return lastScheduledAt(now, slot.hour, slot.minute);
  const hours = Array.from({ length: 24 / slot.everyHours }, (_, index) => slot.hour + index * slot.everyHours!);
  return hours.map((hour) => lastScheduledAt(now, hour, slot.minute)).reduce((latest, at) => (at > latest ? at : latest));
}

/**
 * 하루 한 번인 칸이 예정 시각에서 이만큼 지나도 못 돌았으면 그날은 건너뛴다 (작성자 판단).
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
  const scheduledAt = lastSlotAt(slot, now);
  const handled = handledAt ? Date.parse(handledAt) : Number.NaN;
  if (Number.isFinite(handled) && handled >= scheduledAt.getTime()) return { action: "wait" };
  return now.getTime() - scheduledAt.getTime() <= (slot.windowMs ?? nightlyWindowMs) ? { action: "run", scheduledAt } : { action: "skip", scheduledAt };
}

/** 날짜로 정하는 봇 시드(YYYYMMDD). 같은 날 다시 돌리면 같은 길을 간다 */
export function nightlySeed(scheduledAt: Date): number {
  return scheduledAt.getFullYear() * 10_000 + (scheduledAt.getMonth() + 1) * 100 + scheduledAt.getDate();
}

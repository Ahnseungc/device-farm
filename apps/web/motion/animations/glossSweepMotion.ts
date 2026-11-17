import type { MotionTier } from "../motion-tier";

/**
 * Figma gloss/shine sweep — highlight wrapper track (0,0)→(99,0).
 * 원형 배지(64px) 기준: 시작 left -34px · 스윕 99px · 종료 left 65px(부모 밖).
 * 더 넓은 배지는 `resolveGlossSweepTranslateXPx`로 거리를 늘린다.
 */
export const GLOSS_SWEEP_START_LEFT_PX = -34;
export const GLOSS_SWEEP_TRANSLATE_X_PX = 99;
/** 전체 루프(스윕 + 홀드) */
export const GLOSS_SWEEP_DURATION_S = 2;
/** 스윕 완료 시점 — ~806ms / 2s */
export const GLOSS_SWEEP_COMPLETE_AT = 0.403;
/** 스윕 구간 cubic-bezier(0.719, 0, 1, 1) */
export const GLOSS_SWEEP_EASE = [0.719, 0, 1, 1] as const;

export const GLOSS_SWEEP_TIMES = [0, GLOSS_SWEEP_COMPLETE_AT, 1] as const;

/**
 * 부모 폭보다 스윕이 짧으면 홀드 구간에 하이라이트가 오른쪽 끝에 걸려 멈춰 보인다.
 * 종료 시 strip 왼쪽 변이 부모 오른쪽 변에 닿도록 `부모 폭 - 시작 left`를 쓰고,
 * Figma 트랙(99px)을 하한으로 둔다.
 */
export function resolveGlossSweepTranslateXPx(parentWidthPx: number): number {
  return Math.max(parentWidthPx - GLOSS_SWEEP_START_LEFT_PX, GLOSS_SWEEP_TRANSLATE_X_PX);
}

/** Framer: 스윕 구간 ease + 홀드 linear */
export const GLOSS_SWEEP_SEGMENT_EASE = [
  GLOSS_SWEEP_EASE,
  "linear",
] as const;

/** 모션 등급별 스윕 반복. reduced 는 1회만 지나가고 멈춘다 (minimal 은 컴포넌트가 미렌더) */
const GLOSS_SWEEP_REPEAT_BY_TIER = {
  full: Infinity,
  reduced: 0,
  minimal: 0,
} as const satisfies Record<MotionTier, number>;

export function resolveGlossSweepRepeat(tier: MotionTier): number {
  return GLOSS_SWEEP_REPEAT_BY_TIER[tier];
}

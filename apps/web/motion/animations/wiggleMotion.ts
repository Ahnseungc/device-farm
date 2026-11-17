import type { Transition } from "framer-motion";

/*
 * 좌우 흔들림 — @toss/tds-react-native 2.0.5 `interactions/animation/useWiggleAnim`
 * (small 2·-2·1·-1px, big 4·-4·2·-2px, 단계마다 87.5ms, linear)를 웹으로 옮겼다.
 * Licensed under the Apache License, Version 2.0 — 원문: components/cash-amount-input/AmountKeypad/LICENSE.tds-react-native.txt
 * 변경: 마지막에 0 으로 돌아오는 단계를 더했다 (원본은 마지막 값에서 멈춤)
 */

/** 흔들림 단계(px) — 0 에서 시작해 0 으로 돌아온다 */
export const WIGGLE_X_PX = {
  small: [0, 2, -2, 1, -1, 0],
  big: [0, 4, -4, 2, -2, 0],
} as const;

export type WiggleSize = keyof typeof WIGGLE_X_PX;

/** 한 단계 시간(초) */
export const WIGGLE_STEP_S = 0.0875;

/** 흔들림 전체 시간 — 단계 수 × 87.5ms, 일정한 속도 */
export function wiggleTransition(size: WiggleSize = "big"): Transition {
  return { duration: WIGGLE_STEP_S * (WIGGLE_X_PX[size].length - 1), ease: "linear" };
}

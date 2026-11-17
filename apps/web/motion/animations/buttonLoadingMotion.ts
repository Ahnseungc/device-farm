import type { Transition } from "framer-motion";

import { MOTION_EASE } from "./motionTokens";

/*
 * 버튼 로딩 배경 — @toss/tds-mobile 2.5.1 `Button` loading 의 배경 모션 값을 옮겼다.
 * (패키지에 라이선스 표기 없음. 2026-11-04 사용자 승인으로 값을 읽어 옮김)
 * - 숨쉬기: 버튼 가운데 원형 그라데이션(버튼 폭의 105%, 버튼색보다 한 단계 진한 색)이
 *   투명도 0 ↔ 0.7(채움) / 0.24(옅은 버튼)을 0.6초씩 out 이징으로 오간다
 * - 딤: 검정(투명도 0.26)을 0.13 만큼 얹어 살짝 눌린 듯 어둡게
 */

/** 숨쉬기 최대 투명도 — 채움 버튼 / 옅은 버튼 */
export const BUTTON_LOADING_BREATH_PEAK = { fill: 0.7, weak: 0.24 } as const;

export type ButtonLoadingTone = keyof typeof BUTTON_LOADING_BREATH_PEAK;

/** 숨쉬기 한쪽 시간(초) */
export const BUTTON_LOADING_BREATH_S = 0.6;

/** 딤 투명도 */
export const BUTTON_LOADING_DIM_OPACITY = 0.13;

/** 원형 그라데이션 크기 — 버튼 폭 대비 */
export const BUTTON_LOADING_BREATH_WIDTH = "105%";

/** framer `motion.span` 에 펼치는 숨쉬기 무한 반복 props */
export function buttonLoadingBreathMotion(tone: ButtonLoadingTone) {
  const transition: Transition = {
    duration: BUTTON_LOADING_BREATH_S,
    ease: MOTION_EASE.out,
    repeat: Infinity,
    repeatType: "reverse",
  };
  return {
    initial: { opacity: 0 },
    animate: { opacity: [0, BUTTON_LOADING_BREATH_PEAK[tone]] },
    exit: { opacity: 0 },
    transition,
  };
}

import type { Target, Transition } from "framer-motion";

/** 페이지 본문 연속 등장 — ease-out 계열 */
export const PAGE_ENTRANCE_EASE = [0.22, 1, 0.36, 1] as const;

export const PAGE_ENTRANCE_DURATION_S = 0.42;

/** 블록 간 겹침을 두어 끊김 없이 이어지도록 짧게 */
export const PAGE_ENTRANCE_STAGGER_S = 0.045;

export const PAGE_ENTRANCE_DELAY_CHILDREN_S = 0;

export const PAGE_ENTRANCE_Y_OFFSET_PX = 10;

/** 페이지 전체가 위에서 아래로 내려오는 단일 슬라이드 */
export const PAGE_SLIDE_Y_OFFSET_PX = 28;

export const PAGE_SLIDE_DURATION_S = 0.48;

/** 슬라이드보다 짧게 페이드인 — 내려오면서 먼저 선명해지는 느낌 */
export const PAGE_SLIDE_OPACITY_DURATION_S = 0.36;

export const PAGE_SLIDE_OPACITY_INITIAL = 0;

/** 합성 레이어 승격 — transform·opacity 전용 애니메이션 구간 */
export const PAGE_SLIDE_WILL_CHANGE = "transform, opacity";

/** GPU 레이어 분리 (WebView 합성 안정) */
export const PAGE_SLIDE_GPU_LAYER_CLASS =
  "transform-gpu backface-hidden [transform:translateZ(0)]";

export const PAGE_SLIDE_INITIAL: Target = {
  opacity: PAGE_SLIDE_OPACITY_INITIAL,
  y: -PAGE_SLIDE_Y_OFFSET_PX,
};

export const PAGE_SLIDE_ANIMATE: Target = {
  opacity: 1,
  y: 0,
};

export function pageEntranceTransition(
  delay = 0,
  overrides?: Partial<Transition>,
): Transition {
  return {
    duration: PAGE_ENTRANCE_DURATION_S,
    ease: PAGE_ENTRANCE_EASE,
    delay,
    ...overrides,
  };
}

export function pageSlideTransition(
  delay = 0,
  overrides?: Partial<Transition>,
): Transition {
  return {
    y: {
      duration: PAGE_SLIDE_DURATION_S,
      ease: PAGE_ENTRANCE_EASE,
      delay,
    },
    opacity: {
      duration: PAGE_SLIDE_OPACITY_DURATION_S,
      ease: PAGE_ENTRANCE_EASE,
      delay,
    },
    ...overrides,
  };
}

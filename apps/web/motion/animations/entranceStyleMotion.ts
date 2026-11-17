import type { Target, Transition } from "framer-motion";

/** 토스 스타일 ease — framer-motion-interaction.mdc 기본값 */
export const ENTRANCE_STYLE_EASE = [0.22, 1, 0.36, 1] as const;

export const ENTRANCE_STYLE_DURATION = {
  container: 0.3,
  child: 0.26,
  list: 0.32,
} as const;

/** 연속 스태거 간격(초) */
export const ENTRANCE_STYLE_STAGGER_STEP_S = 0.06;

/** 패널 → 연결선 → 1행 → 2행 등장 시 기본 delay(초) */
export const ENTRANCE_STYLE_DELAY = {
  connector: 0.08,
  firstRow: 0.12,
  secondRow: 0.2,
} as const;

export const ENTRANCE_STYLE_CONTAINER_INITIAL: Target = { opacity: 0, y: -8 };
export const ENTRANCE_STYLE_CONTAINER_ANIMATE: Target = { opacity: 1, y: 0 };

export const ENTRANCE_STYLE_CHILD_INITIAL: Target = { opacity: 0, y: -6, scale: 0.98 };
export const ENTRANCE_STYLE_CHILD_ANIMATE: Target = { opacity: 1, y: 0, scale: 1 };

export const ENTRANCE_STYLE_HORIZONTAL_INITIAL: Target = { opacity: 0, scaleX: 0.92 };
export const ENTRANCE_STYLE_HORIZONTAL_ANIMATE: Target = { opacity: 1, scaleX: 1 };

/** 오른쪽에서 왼쪽으로 슬라이드하며 등장 (리스트·피드 행) */
export const ENTRANCE_STYLE_SLIDE_IN_RIGHT_DISTANCE = 24;
export const ENTRANCE_STYLE_SLIDE_IN_RIGHT_INITIAL: Target = {
  opacity: 0,
  x: ENTRANCE_STYLE_SLIDE_IN_RIGHT_DISTANCE,
};
export const ENTRANCE_STYLE_SLIDE_IN_RIGHT_ANIMATE: Target = { opacity: 1, x: 0 };

/** 스태거 delay 상한 — 긴 리스트에서 마지막 행 대기 시간 폭주 방지 */
export const ENTRANCE_STYLE_STAGGER_MAX_INDEX = 12;

export function entranceStyleContainerTransition(
  overrides?: Partial<Transition>,
): Transition {
  return {
    duration: ENTRANCE_STYLE_DURATION.container,
    ease: ENTRANCE_STYLE_EASE,
    ...overrides,
  };
}

export function entranceStyleChildTransition(
  delay = 0,
  overrides?: Partial<Transition>,
): Transition {
  return {
    duration: ENTRANCE_STYLE_DURATION.child,
    ease: ENTRANCE_STYLE_EASE,
    delay,
    ...overrides,
  };
}

export function entranceStyleListTransition(
  delay = 0,
  overrides?: Partial<Transition>,
): Transition {
  return {
    duration: ENTRANCE_STYLE_DURATION.list,
    ease: ENTRANCE_STYLE_EASE,
    delay,
    ...overrides,
  };
}

export function entranceStyleStaggerDelay(
  index: number,
  baseDelay: number,
  maxIndex = ENTRANCE_STYLE_STAGGER_MAX_INDEX,
): number {
  const cappedIndex = Math.min(Math.max(index, 0), maxIndex);
  return baseDelay + cappedIndex * ENTRANCE_STYLE_STAGGER_STEP_S;
}

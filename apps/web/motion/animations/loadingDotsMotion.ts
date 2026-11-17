import type { Transition } from "framer-motion";

/*
 * 로딩 점 3개 — @toss/tds-mobile 2.5.1 `Button` loading 의 점 모션·크기 값을 옮겼다.
 * (패키지에 라이선스 표기 없음. 2026-11-04 사용자 승인으로 값을 읽어 옮김)
 * 점마다 opacity 0.2·scale 0.8 ↔ 1·1 을 0.3초씩 오가고(기본 이징), 점끼리 0.1초씩 늦게 시작한다.
 */

export const LOADING_DOTS_COUNT = 3;

/** 한 번 흐림→밝음(또는 반대)에 걸리는 시간(초) */
export const LOADING_DOT_STEP_S = 0.3;

/** 점끼리 시작 간격(초) */
export const LOADING_DOT_STAGGER_S = 0.1;

const LOADING_DOT_DIM = { opacity: 0.2, scale: 0.8 } as const;
const LOADING_DOT_BRIGHT = { opacity: 1, scale: 1 } as const;

/**
 * 점 크기·간격 — TDS medium(5px·4px) / xlarge(8px·7px).
 * Tailwind spacing 4px 기준: size-1.25 = 5px, size-2 = 8px, gap-1 = 4px, gap-1.75 = 7px
 */
export const LOADING_DOTS_SIZE_CLASS = {
  small: { dot: "size-1.25", gap: "gap-1" },
  large: { dot: "size-2", gap: "gap-1.75" },
} as const;

export type LoadingDotsSize = keyof typeof LOADING_DOTS_SIZE_CLASS;

/** framer `motion.span` 에 펼치는 점 하나의 무한 반복 props */
export function loadingDotMotion(index: number) {
  const transition: Transition = {
    duration: LOADING_DOT_STEP_S,
    repeat: Infinity,
    repeatType: "reverse",
    delay: index * LOADING_DOT_STAGGER_S,
  };
  return { initial: LOADING_DOT_DIM, animate: LOADING_DOT_BRIGHT, transition };
}

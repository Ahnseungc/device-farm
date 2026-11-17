import type { Transition } from "framer-motion";

/*
 * TDS(Toss Design System) 모션 토큰 — @toss/tds-easings 0.0.1 의 bezier·spring 값을 그대로 옮겼다.
 * (패키지에 라이선스 표기 없음. 2026-11-04 요청으로 값을 읽어 옮김)
 * TDS RN 컴포넌트는 Animated.spring({ stiffness, damping, mass: 1 }) 로 쓰고, framer-motion spring 도 같은 물리 모델이다.
 */

/** 이징 곡선 — TDS bezier */
export const MOTION_EASE = {
  linear: [0, 0, 1, 1],
  /** TDS `ease` — 천천히 출발해 천천히 멈춘다 */
  ease: [0.6, 0, 0, 0.6],
  /** TDS `out` — CSS ease 와 같다. rally 기본 이징 */
  out: [0.25, 0.1, 0.25, 1],
  /** 빠르게 출발해 길게 감속 */
  expo: [0.16, 1, 0.3, 1],
  /** 목표를 살짝 넘었다 돌아온다 */
  back: [0.34, 1.56, 0.64, 1],
} as const;

export type MotionEaseName = keyof typeof MOTION_EASE;

/** spring — TDS spring 프리셋 (mass 1) */
export const MOTION_SPRING = {
  /** 누를 때처럼 즉각 */
  rapid: { type: "spring", stiffness: 1000, damping: 55 },
  /** 뗄 때·작은 상태 전환·토스트·딤 */
  quick: { type: "spring", stiffness: 800, damping: 55 },
  /** 작은 요소 이동 (상단 토스트 등) */
  small: { type: "spring", stiffness: 480, damping: 50 },
  /** 툴팁 등장·퇴장 — 살짝 출렁인다 */
  medium: { type: "spring", stiffness: 270, damping: 25 },
  /** 일반 등장·이동 */
  basic: { type: "spring", stiffness: 200, damping: 30 },
  /** 튕기는 마무리 */
  bounce: { type: "spring", stiffness: 300, damping: 15 },
  /** 큰 영역 — 많이 출렁인다 */
  large: { type: "spring", stiffness: 100, damping: 15 },
  /** 넓은 영역이 천천히 자리 잡을 때 */
  slow: { type: "spring", stiffness: 70, damping: 20 },
} as const satisfies Record<string, Transition>;

export type MotionSpringName = keyof typeof MOTION_SPRING;

/** 원근 회전(flip·roll·snap·3D 흔들림) 원근 거리(px) — TDS strong(요소 폭 × 4)을 폭 300px 기준으로 고정 */
export const MOTION_PERSPECTIVE_PX = 1200;

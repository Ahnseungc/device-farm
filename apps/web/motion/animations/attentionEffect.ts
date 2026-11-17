import type { Target, Transition } from "framer-motion";

import { MOTION_EASE, MOTION_PERSPECTIVE_PX } from "./motionTokens";

/*
 * 강조 효과 — @toss/tds-react-native 2.0.5 `interactions/rally/presets/effects`
 * (pulse·bounce·float·float3d·ripple·shiver·wiggle·wiggle3d)의 크기·각도·단계 시간을 웹(framer-motion 키프레임)으로 옮겼다.
 * Licensed under the Apache License, Version 2.0 — 원문: components/cash-amount-input/AmountKeypad/LICENSE.tds-react-native.txt
 * 변경: TDS 의 `+=`·`-=` 상대 단계를 쉬는 자세(0·1) 기준 절대 키프레임으로 풀었다. 이징은 motionTokens(TDS bezier).
 *       wiggle 좌우는 기존 wiggleMotion 이 있어 여기엔 위아래(wiggleY)만 둔다.
 */

export type AttentionEffectName =
  | "pulse"
  | "bounce"
  | "float"
  | "float3d"
  | "ripple"
  | "shiver"
  | "wiggleY"
  | "wiggle3d";

export type AttentionEffectSize = "small" | "big";

interface EffectFrames {
  keyframes: Target;
  /** 단계별 시간(초) — 키프레임 사이 구간 수와 같다 */
  stepsS: readonly number[];
  /** 하나면 모든 구간, 배열이면 구간별 이징 */
  ease: Transition["ease"];
  /** 속성마다 구간 이징이 다를 때 (float3d) */
  easeByKey?: Record<string, Transition["ease"]>;
}

/** float3d 가 번갈아 쓰는 두 곡선 — TDS float3d 원본 값 */
const FLOAT3D_EASE = { a: [0.5, 0.2, 0.8, 0.5], b: [0.2, 0.5, 0.5, 0.8] } as const;
const FLOAT3D_EASE_X = [
  FLOAT3D_EASE.b,
  FLOAT3D_EASE.a,
  FLOAT3D_EASE.b,
  FLOAT3D_EASE.a,
  FLOAT3D_EASE.b,
  FLOAT3D_EASE.a,
];
const FLOAT3D_EASE_Y = [
  FLOAT3D_EASE.a,
  FLOAT3D_EASE.b,
  FLOAT3D_EASE.a,
  FLOAT3D_EASE.b,
  FLOAT3D_EASE.a,
  FLOAT3D_EASE.b,
];

const PERSPECTIVE = { transformPerspective: MOTION_PERSPECTIVE_PX } as const;

const EFFECTS: Record<AttentionEffectName, Record<AttentionEffectSize, EffectFrames>> = {
  // 살짝 커졌다 돌아온다
  pulse: {
    small: { keyframes: { scale: [1, 1.03, 1] }, stepsS: [0.15, 0.15], ease: MOTION_EASE.out },
    big: { keyframes: { scale: [1, 1.1, 1] }, stepsS: [0.15, 0.15], ease: MOTION_EASE.out },
  },
  // 바닥 쪽으로 눌리며 찌그러졌다 튀어 돌아온다 (아래 모서리 기준)
  bounce: {
    small: {
      keyframes: { originY: 1, y: ["0%", "40%", "0%"], scaleY: [1, 0.9, 1], scaleX: [1, 1.02, 1] },
      stepsS: [0.15, 0.25],
      ease: [MOTION_EASE.ease, MOTION_EASE.out],
    },
    big: {
      keyframes: { originY: 1, y: ["0%", "80%", "0%"], scaleY: [1, 0.9, 1], scaleX: [1, 1.02, 1] },
      stepsS: [0.25, 0.35],
      ease: [MOTION_EASE.ease, MOTION_EASE.out],
    },
  },
  // 위로 둥실 떴다 내려온다 — repeat 와 함께 쓴다
  float: {
    small: { keyframes: { y: ["0%", "-20%", "0%"] }, stepsS: [0.8, 0.7], ease: MOTION_EASE.out },
    big: { keyframes: { y: ["0%", "-35%", "0%"] }, stepsS: [1, 0.9], ease: MOTION_EASE.out },
  },
  // 원근감 있게 기울며 한 바퀴 둥실 (12초)
  float3d: {
    small: {
      keyframes: {
        ...PERSPECTIVE,
        rotateX: [0, 4, 0, -8, 0, 4, 0],
        rotateY: [0, 4, 8, 0, -8, -4, 0],
      },
      stepsS: [1.5, 1.5, 3, 3, 1.5, 1.5],
      ease: "linear",
      easeByKey: { rotateX: FLOAT3D_EASE_X, rotateY: FLOAT3D_EASE_Y },
    },
    big: {
      keyframes: {
        ...PERSPECTIVE,
        rotateX: [0, 10, 0, -20, 0, 10, 0],
        rotateY: [0, 10, 20, 0, -20, -10, 0],
      },
      stepsS: [1.5, 1.5, 3, 3, 1.5, 1.5],
      ease: "linear",
      easeByKey: { rotateX: FLOAT3D_EASE_X, rotateY: FLOAT3D_EASE_Y },
    },
  },
  // 커지며 사라지는 파동 — 원본 위에 겹친 복제본에 쓴다
  ripple: {
    small: {
      keyframes: { scale: [1, 1.15], opacity: [1, 0] },
      stepsS: [0.8],
      ease: MOTION_EASE.out,
    },
    big: { keyframes: { scale: [1, 1.4], opacity: [1, 0] }, stepsS: [0.8], ease: MOTION_EASE.out },
  },
  // 짧게 떤다 (알림 벨 등)
  shiver: {
    small: {
      keyframes: { rotate: [0, -1, 1, -0.5, 0], originX: [0.5, 0.45, 0.55, 0.45, 0.5] },
      stepsS: [0.075, 0.075, 0.075, 0.075],
      ease: "linear",
    },
    big: {
      keyframes: { rotate: [0, -2, 2, -1, 0], originX: [0.5, 0.45, 0.55, 0.45, 0.5] },
      stepsS: [0.075, 0.075, 0.075, 0.075],
      ease: "linear",
    },
  },
  // 위아래로 흔든다
  wiggleY: {
    small: {
      keyframes: { y: [0, 2, -2, 1, 0] },
      stepsS: [0.0875, 0.0875, 0.0875, 0.0875],
      ease: "linear",
    },
    big: {
      keyframes: { y: [0, 4, -4, 2, 0] },
      stepsS: [0.0875, 0.0875, 0.0875, 0.0875],
      ease: "linear",
    },
  },
  // 좌우로 흔들며 비튼다
  wiggle3d: {
    small: {
      keyframes: { ...PERSPECTIVE, x: [0, 6, -6, 3, 0], rotateY: [0, 6, -6, 3, 0] },
      stepsS: [0.125, 0.125, 0.125, 0.125],
      ease: "linear",
    },
    big: {
      keyframes: { ...PERSPECTIVE, x: [0, 10, -10, 5, 0], rotateY: [0, 10, -10, 5, 0] },
      stepsS: [0.125, 0.125, 0.125, 0.125],
      ease: "linear",
    },
  },
};

/** 단계 시간을 framer `times`(0~1 누적 비율)로 바꾼다 */
export function stepsToTimes(stepsS: readonly number[]) {
  const total = stepsS.reduce((sum, step) => sum + step, 0);
  let elapsed = 0;
  return [0, ...stepsS.map((step) => (elapsed += step) / total)];
}

export interface AttentionEffectOptions {
  size?: AttentionEffectSize;
  /** 반복 횟수 — Infinity 면 계속 */
  repeat?: number;
  /** 반복 사이 쉬는 시간(초) */
  repeatDelay?: number;
}

/**
 * framer `animate`·`transition` 에 펼치는 강조 효과. `key` 를 바꿔 다시 재생한다.
 *
 * @example
 * <motion.span key={tapCount} {...attentionEffect("pulse", { size: "big" })} />
 */
export function attentionEffect(name: AttentionEffectName, options: AttentionEffectOptions = {}) {
  const frames = EFFECTS[name][options.size ?? "big"];
  const base: Transition = {
    duration: frames.stepsS.reduce((sum, step) => sum + step, 0),
    times: stepsToTimes(frames.stepsS),
    ease: frames.ease,
    repeat: options.repeat ?? 0,
    repeatDelay: options.repeatDelay ?? 0,
  };
  const perKey = Object.fromEntries(
    Object.entries(frames.easeByKey ?? {}).map(([key, ease]) => [key, { ...base, ease }]),
  );
  const transition: Transition = { ...base, ...perKey };
  return { animate: frames.keyframes, transition };
}

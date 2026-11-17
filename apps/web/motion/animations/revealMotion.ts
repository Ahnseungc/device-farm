import type { Target, Transition } from "framer-motion";

import { MOTION_EASE, MOTION_PERSPECTIVE_PX } from "./motionTokens";

/*
 * 등장·퇴장 프리셋 — @toss/tds-react-native 2.0.5 `interactions/rally/presets/transitions`
 * (fade·slide·scale·zoom·flip·roll·snap 과 각 Bounce)의 거리·각도·크기·시간을 웹(framer-motion)으로 옮겼다.
 * Licensed under the Apache License, Version 2.0 — 원문: components/cash-amount-input/AmountKeypad/LICENSE.tds-react-native.txt
 * 변경: 이징은 motionTokens(MOTION_EASE). 원근은 요소 폭 대신 MOTION_PERSPECTIVE_PX 고정.
 */

export type RevealName =
  | "fade"
  | "slide"
  | "slideBounce"
  | "scale"
  | "scaleBounce"
  | "zoom"
  | "flip"
  | "flipBounce"
  | "roll"
  | "rollBounce"
  | "snap"
  | "snapBounce";

/** fast: 또렷하게(기본) · slow: 잔잔하게 */
export type RevealSpeed = "fast" | "slow";

/** slide 가 들어오는 쪽으로 움직이는 방향 — up 은 아래에서 위로 올라온다(fade-up) */
export type RevealDirection = "up" | "down" | "left" | "right";

/** slide 이동 거리(px) */
export const REVEAL_SLIDE_DISTANCE_PX = { vertical: 80, horizontal: 50 } as const;

const SLIDE_IN_OFFSET: Record<RevealDirection, Target> = {
  up: { y: REVEAL_SLIDE_DISTANCE_PX.vertical },
  down: { y: -REVEAL_SLIDE_DISTANCE_PX.vertical },
  left: { x: REVEAL_SLIDE_DISTANCE_PX.horizontal },
  right: { x: -REVEAL_SLIDE_DISTANCE_PX.horizontal },
};

const SLIDE_OUT_OFFSET: Record<RevealDirection, Target> = {
  up: { y: -REVEAL_SLIDE_DISTANCE_PX.vertical },
  down: { y: REVEAL_SLIDE_DISTANCE_PX.vertical },
  left: { x: -REVEAL_SLIDE_DISTANCE_PX.horizontal },
  right: { x: REVEAL_SLIDE_DISTANCE_PX.horizontal },
};

const PERSPECTIVE = { transformPerspective: MOTION_PERSPECTIVE_PX } as const;

/** 프리셋별 숨은 상태 — in: 등장 전, out: 퇴장 후 */
const HIDDEN: Record<Exclude<RevealName, "slide" | "slideBounce">, { in: Target; out: Target }> = {
  fade: { in: { opacity: 0 }, out: { opacity: 0 } },
  scale: { in: { opacity: 0, scale: 0.6 }, out: { opacity: 0, scale: 0.6 } },
  scaleBounce: { in: { opacity: 0, scale: 0.6 }, out: { opacity: 0, scale: 0.6 } },
  zoom: { in: { opacity: 0, scale: 2 }, out: { opacity: 0, scale: 2 } },
  flip: {
    in: { ...PERSPECTIVE, opacity: 0, rotateX: -70 },
    out: { ...PERSPECTIVE, opacity: 0, rotateX: 70 },
  },
  flipBounce: {
    in: { ...PERSPECTIVE, opacity: 0, rotateX: -70 },
    out: { ...PERSPECTIVE, opacity: 0, rotateX: 70 },
  },
  roll: {
    in: { ...PERSPECTIVE, opacity: 0, rotateX: -70, scale: 0.8, y: "50%" },
    out: { ...PERSPECTIVE, opacity: 0, rotateX: 70, scale: 0.8, y: "-50%" },
  },
  rollBounce: {
    in: { ...PERSPECTIVE, opacity: 0, rotateX: -70, scale: 0.8, y: "50%" },
    out: { ...PERSPECTIVE, opacity: 0, rotateX: 70, scale: 0.8, y: "-50%" },
  },
  // snap — 들어올 땐 위 모서리, 나갈 땐 아래 모서리를 축으로 접힌다
  snap: {
    in: { ...PERSPECTIVE, opacity: 0, rotateX: 50, originY: 0 },
    out: { ...PERSPECTIVE, opacity: 0, rotateX: -50, originY: 1 },
  },
  snapBounce: {
    in: { ...PERSPECTIVE, opacity: 0, rotateX: 50, originY: 0 },
    out: { ...PERSPECTIVE, opacity: 0, rotateX: -50, originY: 1 },
  },
};

const SHOWN: Target = { opacity: 1, x: 0, y: 0, scale: 1, rotateX: 0 };

/** 프리셋별 [fast, slow] 이징·시간(초) */
const TIMING: Record<
  RevealName,
  Record<RevealSpeed, { ease: Transition["ease"]; duration: number }>
> = {
  fade: {
    fast: { ease: MOTION_EASE.ease, duration: 0.6 },
    slow: { ease: "linear", duration: 0.6 },
  },
  slide: {
    fast: { ease: MOTION_EASE.expo, duration: 0.8 },
    slow: { ease: MOTION_EASE.out, duration: 0.6 },
  },
  scale: {
    fast: { ease: MOTION_EASE.expo, duration: 0.8 },
    slow: { ease: MOTION_EASE.out, duration: 0.6 },
  },
  zoom: {
    fast: { ease: MOTION_EASE.expo, duration: 0.7 },
    slow: { ease: MOTION_EASE.out, duration: 0.6 },
  },
  flip: {
    fast: { ease: MOTION_EASE.expo, duration: 0.8 },
    slow: { ease: MOTION_EASE.ease, duration: 0.6 },
  },
  roll: {
    fast: { ease: MOTION_EASE.expo, duration: 0.8 },
    slow: { ease: MOTION_EASE.out, duration: 0.6 },
  },
  snap: {
    fast: { ease: MOTION_EASE.expo, duration: 0.6 },
    slow: { ease: MOTION_EASE.ease, duration: 0.6 },
  },
  slideBounce: {
    fast: { ease: MOTION_EASE.back, duration: 0.55 },
    slow: { ease: MOTION_EASE.back, duration: 0.8 },
  },
  scaleBounce: {
    fast: { ease: MOTION_EASE.back, duration: 0.55 },
    slow: { ease: MOTION_EASE.back, duration: 0.8 },
  },
  flipBounce: {
    fast: { ease: MOTION_EASE.back, duration: 0.55 },
    slow: { ease: MOTION_EASE.back, duration: 0.8 },
  },
  rollBounce: {
    fast: { ease: MOTION_EASE.back, duration: 0.55 },
    slow: { ease: MOTION_EASE.back, duration: 0.8 },
  },
  snapBounce: {
    fast: { ease: MOTION_EASE.back, duration: 0.55 },
    slow: { ease: MOTION_EASE.back, duration: 0.8 },
  },
};

export interface RevealOptions {
  speed?: RevealSpeed;
  /** slide·slideBounce 전용 (기본 up — fade-up) */
  direction?: RevealDirection;
  /** slide 에서 투명도도 함께 바꿀지 (기본 켬) */
  withOpacity?: boolean;
  /** slide 이동 거리(px) — 기본 `REVEAL_SLIDE_DISTANCE_PX`. 헤더 아이콘처럼 작은 요소는 줄인다 */
  distance?: number;
  delay?: number;
  /** 퇴장 시작을 늦춘다(초) — 여러 요소가 차례로 딸려 나갈 때 */
  exitDelay?: number;
}

/** 방향 부호는 두고 거리만 바꾼다 */
function withSlideDistance(offset: Target, distance: number | undefined): Target {
  if (distance === undefined) return offset;
  return Object.fromEntries(
    Object.entries(offset).map(([axis, value]) => [axis, Math.sign(Number(value)) * distance]),
  );
}

function hiddenOf(name: RevealName, phase: "in" | "out", options: RevealOptions): Target {
  if (name !== "slide" && name !== "slideBounce") return HIDDEN[name][phase];
  const direction = options.direction ?? "up";
  const offset = withSlideDistance(
    phase === "in" ? SLIDE_IN_OFFSET[direction] : SLIDE_OUT_OFFSET[direction],
    options.distance,
  );
  return options.withOpacity === false ? offset : { ...offset, opacity: 0 };
}

/**
 * framer `motion.*` 에 그대로 펼치는 등장·퇴장 props. 퇴장(exit)은 `AnimatePresence` 안에서 동작한다.
 *
 * @example
 * <motion.p {...revealMotion("slide", { direction: "up" })}>금액</motion.p>
 */
export function revealMotion(name: RevealName, options: RevealOptions = {}) {
  const timing = TIMING[name][options.speed ?? "fast"];
  const transition: Transition = { ...timing, delay: options.delay ?? 0 };
  return {
    initial: hiddenOf(name, "in", options),
    animate: SHOWN,
    exit: {
      ...hiddenOf(name, "out", options),
      transition: { ...timing, delay: options.exitDelay ?? 0 },
    },
    transition,
  };
}

/** 프리셋 등장 시간(초) — 다음 요소를 등장 도중에 이어 붙일 때 쓴다 */
export function revealDurationS(name: RevealName, speed: RevealSpeed = "fast"): number {
  return TIMING[name][speed].duration;
}

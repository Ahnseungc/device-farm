import type { Target, TargetAndTransition, Transition, Variants } from "framer-motion";

import { MOTION_EASE, MOTION_SPRING } from "./motionTokens";

/*
 * 숫자 입력·지우기 — 토스 앱 금액 키패드에서 본 동작을 옮겼다 (TDS 패키지 코드에는 없음).
 * 새 자릿수는 위에서 떨어지고, 지운 자릿수는 왼쪽 위로 날아간다. 나머지 자릿수·콤마는 움직이지 않는다.
 * 거리는 글자 크기 기준(em)이라 금액 글자 크기가 바뀌어도 비율이 같다.
 */

/** 새 자릿수가 들어오기 전 — 반 글자 위 */
export const DIGIT_TYPE_IN_FROM: Target = { opacity: 0, y: "-0.5em" };
export const DIGIT_TYPE_SHOWN: Target = { opacity: 1, x: 0, y: 0 };
/** 지운 자릿수가 왼쪽 위로 날아가는 시간(초) */
export const DIGIT_TYPE_OUT_S = 0.3;

/**
 * 지운 자릿수가 날아가는 곳 — 왼쪽 위.
 * 흐려지는 시간을 날아가는 시간과 맞추고, 천천히 출발하는 `ease` 로 흐려 끝까지 날아가는 게 보인다.
 * (이전: 0.15초 `out` 이징으로 먼저 사라져 날아가는 도중에 안 보였다)
 */
export const DIGIT_TYPE_OUT_TO: TargetAndTransition = {
  opacity: 0,
  x: "-0.3em",
  y: "-0.5em",
  transition: {
    duration: DIGIT_TYPE_OUT_S,
    ease: MOTION_EASE.out,
    opacity: { duration: DIGIT_TYPE_OUT_S, ease: MOTION_EASE.ease },
  },
};

export const DIGIT_TYPE_TRANSITION: Transition = MOTION_SPRING.quick;

/**
 * 마지막 자릿수 variants — `custom` 에 「자릿수를 새로 쳤는지」(isTyping)를 넘긴다.
 * - 새로 친 자릿수: 위에서 떨어진다 / 지워서 마지막이 된 자릿수: 그대로 보인다
 * - 새로 쳐서 밀려난 자릿수: 앞 글자로 옮겨 그리므로 바로 없앤다 / 지운 자릿수: 왼쪽 위로 날아간다
 *
 * @example
 * <AnimatePresence initial={false} mode='popLayout' custom={isTyping}>
 *   <motion.span key={digitCount} custom={isTyping} variants={DIGIT_TYPE_VARIANTS} initial='enter' animate='shown' exit='leave'>
 *     {lastDigit}
 *   </motion.span>
 * </AnimatePresence>
 */
export const DIGIT_TYPE_VARIANTS = {
  enter: (isTyping: boolean) => (isTyping ? DIGIT_TYPE_IN_FROM : DIGIT_TYPE_SHOWN),
  shown: { ...DIGIT_TYPE_SHOWN, transition: DIGIT_TYPE_TRANSITION },
  leave: (isTyping: boolean) =>
    isTyping ? { opacity: 0, transition: { duration: 0 } } : DIGIT_TYPE_OUT_TO,
} satisfies Variants;

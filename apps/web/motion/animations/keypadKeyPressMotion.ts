import type { Transition } from "framer-motion";

import { MOTION_SPRING } from "./motionTokens";

/*
 * 키패드 키 눌림 — @toss/tds-mobile 2.5.1(웹) `NumberKeypad`·`VirtualKeypad` 키 눌림을 옮겼다.
 * (패키지에 라이선스 표기 없음. 2026-11-04 요청으로 값을 읽어 옮김)
 * - 글자: 누르면 0.85배(spring rapid), 떼면 1배로 튕기며 돌아온다(spring bounce)
 * - 배경: 누르면 회색 판(greyOpacity100, 모서리 20px)이 바로 켜지고(rapid), 떼면 0.4초 linear 로 꺼진다
 * - 글자색: grey700 → 누르는 동안 grey800
 */

export const KEYPAD_KEY_PRESSED_SCALE = 0.85;
/** 뗄 때 배경·글자색이 돌아오는 시간(초) */
export const KEYPAD_KEY_RELEASE_S = 0.4;

const RELEASE_FADE: Transition = { duration: KEYPAD_KEY_RELEASE_S, ease: "linear" };

/** 키 글자 크기 — `motion.*` 에 펼친다. 모션 줄이기면 크기를 바꾸지 않는다 */
export function keypadKeyScaleMotion(isPressed: boolean, shouldReduceMotion = false) {
  return {
    animate: { scale: isPressed && !shouldReduceMotion ? KEYPAD_KEY_PRESSED_SCALE : 1 },
    transition: isPressed ? MOTION_SPRING.rapid : MOTION_SPRING.bounce,
  };
}

/** 키 뒤 회색 판 — 누르는 동안만 보인다 */
export function keypadKeyUnderlayMotion(isPressed: boolean) {
  return {
    initial: false,
    animate: { opacity: isPressed ? 1 : 0 },
    transition: isPressed ? MOTION_SPRING.rapid : RELEASE_FADE,
  } as const;
}

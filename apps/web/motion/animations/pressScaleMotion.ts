import type { Transition } from "framer-motion";

import { MOTION_SPRING } from "./motionTokens";

/*
 * 눌림 축소 — @toss/tds-react-native 2.0.5 `interactions/pressable-effect`(누르면 0.96배, 떼면 1배, spring)를 웹으로 옮겼다.
 * Licensed under the Apache License, Version 2.0 — 원문: components/cash-amount-input/AmountKeypad/LICENSE.tds-react-native.txt
 * spring 은 TDS 와 같이 누를 때 rapid, 뗄 때 quick (motionTokens). 변경: 회색 underlay 는 넣지 않았다.
 */

/** 눌렸을 때 크기 */
export const PRESS_SCALE_PRESSED = 0.96;

/** 누를 때는 빠르게 붙는다 */
export const PRESS_SCALE_IN_SPRING: Transition = MOTION_SPRING.rapid;

/** 뗄 때는 조금 더 부드럽게 돌아온다 */
export const PRESS_SCALE_OUT_SPRING: Transition = MOTION_SPRING.quick;

/**
 * 눌림 상태에 맞는 framer `animate`·`transition`.
 * 모션 줄이기면 크기를 바꾸지 않는다.
 *
 * @example
 * <motion.span {...pressScaleMotion(isPressed, shouldReduceMotion)} />
 */
export function pressScaleMotion(isPressed: boolean, shouldReduceMotion = false) {
  return {
    animate: { scale: isPressed && !shouldReduceMotion ? PRESS_SCALE_PRESSED : 1 },
    transition: isPressed ? PRESS_SCALE_IN_SPRING : PRESS_SCALE_OUT_SPRING,
  };
}

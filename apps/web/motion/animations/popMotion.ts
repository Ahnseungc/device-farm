import { animate } from "framer-motion";

import { MOTION_SPRING } from "./motionTokens";

/*
 * 탭 팝 — @toss/tds-react-native 2.0.5 `components/rating/EditableRating` (탭 → 1.1 rapid → 1 quick, 누르는 동안 0.9)을 웹으로 옮겼다.
 * Licensed under the Apache License, Version 2.0 — 원문: components/cash-amount-input/AmountKeypad/LICENSE.tds-react-native.txt
 * 변경: 별점 컴포넌트 없이 아무 요소에나 쓰는 프리셋으로 뺐다.
 */

/** 탭 직후 커지는 크기 */
export const POP_SCALE_PEAK = 1.1;
/** 누르고 있는 동안 크기 */
export const POP_SCALE_PRESSED = 0.9;

/** 커질 때는 rapid, 돌아올 때는 quick */
export const POP_UP_SPRING = MOTION_SPRING.rapid;
export const POP_SETTLE_SPRING = MOTION_SPRING.quick;

/**
 * 요소를 1 → 1.1 → 1 로 튕긴다. 모션 줄이기면 아무것도 하지 않는다.
 * 실패(요소 해제 등)는 framer 가 reject 하므로 호출부에서 처리한다.
 *
 * @example
 * const handleClick = (event) => void playPop(event.currentTarget, shouldReduceMotion);
 */
export async function playPop(target: Element, shouldReduceMotion = false): Promise<void> {
  if (shouldReduceMotion) return;
  await animate(target, { scale: POP_SCALE_PEAK }, POP_UP_SPRING);
  await animate(target, { scale: 1 }, POP_SETTLE_SPRING);
}

/**
 * 누르는 동안 0.9 로 줄어드는 framer `animate`·`transition`.
 *
 * @example
 * <motion.button {...popPressMotion(isPressed, shouldReduceMotion)} />
 */
export function popPressMotion(isPressed: boolean, shouldReduceMotion = false) {
  return {
    animate: { scale: isPressed && !shouldReduceMotion ? POP_SCALE_PRESSED : 1 },
    transition: isPressed ? POP_UP_SPRING : POP_SETTLE_SPRING,
  };
}

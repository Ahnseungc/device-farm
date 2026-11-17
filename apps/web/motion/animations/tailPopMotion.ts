import { animate, type DOMKeyframesDefinition, type Transition } from "framer-motion";

import { MOTION_SPRING } from "./motionTokens";

/*
 * 말꼬리 팝 — @toss/tds-react-native 2.0.5 `Tooltip/TooltipBase` 등장·퇴장
 * (opacity·scale 0 → 1, 말꼬리 쪽 기준, 닫힐 땐 반대, spring medium)을 웹으로 옮겼다.
 * Licensed under the Apache License, Version 2.0 — 원문: components/cash-amount-input/AmountKeypad/LICENSE.tds-react-native.txt
 * 기준점(transform-origin)을 말꼬리 끝에 두면 꼬리는 제자리, 몸통만 커진다.
 */

export const TAIL_POP_HIDDEN = { opacity: 0, scale: 0 } as const;
export const TAIL_POP_SHOWN = { opacity: 1, scale: 1 } as const;

export const TAIL_POP_ENTER_TRANSITION: Transition = MOTION_SPRING.medium;
export const TAIL_POP_EXIT_TRANSITION: Transition = MOTION_SPRING.medium;

/** TDS strong — 1.25배까지 커졌다(spring quick) 1배로 튕기며 돌아온다(spring bounce) */
export const TAIL_POP_STRONG_OVERSHOOT_SCALE = 1.25;

/**
 * strong 팝을 요소에 재생한다. 기준점(transform-origin)은 호출부가 말꼬리 쪽으로 둔다.
 *
 * @example
 * useEffect(() => { if (ref.current) void playTailPopStrong(ref.current); }, []);
 */
export async function playTailPopStrong(element: Element) {
  const overshoot: DOMKeyframesDefinition = { opacity: 1, scale: TAIL_POP_STRONG_OVERSHOOT_SCALE };
  await animate(
    element,
    { opacity: [0, 1], scale: [0, TAIL_POP_STRONG_OVERSHOOT_SCALE] },
    MOTION_SPRING.quick,
  );
  await animate(element, { ...overshoot, scale: 1 }, MOTION_SPRING.bounce);
}

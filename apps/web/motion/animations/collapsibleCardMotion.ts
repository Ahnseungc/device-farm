import type { Variants } from "framer-motion";
import {
  COLLAPSIBLE_HEIGHT_CONTENT_VARIANTS,
  COLLAPSIBLE_HEIGHT_TRANSITION,
} from "./collapsibleHeightMotion";
import { MOTION_SPRING } from "./motionTokens";

/**
 * CollapsibleCard 전용 Framer Motion 설정.
 * 이징·variants 정의는 `collapsibleHeightMotion.ts`와 공유한다.
 */

/** AnimatePresence: 마운트 시 자식 enter 애니메이션 생략 */
export const COLLAPSIBLE_CARD_PRESENCE_INITIAL = false;

/**
 * AnimatePresence + height·opacity variants (요약 없음 / closed-only 순차 전환)
 */
export const COLLAPSIBLE_CARD_PRESENCE_VARIANTS: Variants = COLLAPSIBLE_HEIGHT_CONTENT_VARIANTS;

/**
 * collapsedSummary 있음(always): 자식은 항상 마운트하고 height만 토글할 때 공통 props.
 * `initial: false` → 최초 페인트에서 접힘 트윈이 재생되지 않음.
 */
export const COLLAPSIBLE_CARD_SUMMARY_EXPAND_MOTION = {
  initial: false,
  transition: COLLAPSIBLE_HEIGHT_TRANSITION,
} as const;

/**
 * 요약 모드(always)에서 펼침 여부에 따른 `animate` 타깃
 */
export function getCollapsibleCardSummaryContentAnimate(isOpen: boolean) {
  return { height: isOpen ? ("auto" as const) : 0 };
}

/*
 * 접기 chevron 회전 — @toss/tds-react-native 2.0.5 `components/agreement/Collapsible/useAnimatedRotateValue` 를 웹으로 옮겼다.
 * Licensed under the Apache License, Version 2.0 — 원문: components/cash-amount-input/AmountKeypad/LICENSE.tds-react-native.txt
 * 변경: spring 은 공통 `MOTION_SPRING.quick`. 높이 트윈은 기존 호출부 동작을 지키려고 spring 으로 바꾸지 않았다
 *       (height:auto 에 underdamped spring 이면 닫힐 때 0 아래로 튄다).
 */

/** chevron 회전 spring */
export const COLLAPSIBLE_CHEVRON_ROTATE_TRANSITION = MOTION_SPRING.quick;

/** 접힘 상태 chevron 각도(deg) — 기존 `rotate-180` 과 같다 */
export const COLLAPSIBLE_CHEVRON_CLOSED_DEG = 180;

/**
 * chevron `motion` props. 모션 줄이기면 즉시 돈다.
 *
 * @example
 * <motion.span {...collapsibleChevronRotateMotion(isOpen, shouldReduceMotion)}><ChevronIcon /></motion.span>
 */
export function collapsibleChevronRotateMotion(
  isOpen: boolean,
  shouldReduceMotion = false,
  closedDeg: number = COLLAPSIBLE_CHEVRON_CLOSED_DEG,
) {
  return {
    initial: false,
    animate: { rotate: isOpen ? 0 : closedDeg },
    transition: shouldReduceMotion ? { duration: 0 } : COLLAPSIBLE_CHEVRON_ROTATE_TRANSITION,
  } as const;
}

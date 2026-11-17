"use client";

import type { ReactNode } from "react";
import {
  AnimatePresence,
  motion,
  useReducedMotionConfig,
  type Transition,
} from "framer-motion";

import { cn } from "./cn";

import {
  COLLAPSE_INTO_HEADER_FADE_UP_PAIR_TRANSITION,
  DEFAULT_COLLAPSE_INTO_HEADER_OFFSET_PX,
  DEFAULT_COLLAPSE_INTO_HEADER_SCALE_END,
  VERTICAL_ROLL_SLIDE_TRANSITION,
} from "./verticalRollSlide.motion";

export type VerticalRollEnterVariant = "roll" | "fadeUp";

export interface VerticalRollSwapItem {
  key: string;
  /** absolute 레이어 너비·높이 확보용 (aria-hidden 권장) */
  sizer?: ReactNode;
  children: ReactNode;
  panelClassName?: string;
  /** 등장 시만 적용. roll=아래→위 100% 롤링, fadeUp=px+opacity */
  enterVariant?: VerticalRollEnterVariant;
  fadeUpOffsetPx?: number;
  fadeUpScaleEnd?: number;
  /** fadeUp 등장·퇴장 트랜지션 (퇴장 미지정 시 등장과 동일) */
  fadeUpEnterTransition?: Transition;
  fadeUpExitTransition?: Transition;
}

interface FadeUpMotionOptions {
  offsetPx?: number;
  scaleEnd?: number;
}

function getPanelMotionStates(
  enterVariant: VerticalRollEnterVariant = "roll",
  fadeUpOptions: FadeUpMotionOptions = {},
) {
  if (enterVariant === "fadeUp") {
    const offsetPx =
      fadeUpOptions.offsetPx ?? DEFAULT_COLLAPSE_INTO_HEADER_OFFSET_PX;
    const scaleEnd =
      fadeUpOptions.scaleEnd ?? DEFAULT_COLLAPSE_INTO_HEADER_SCALE_END;

    return {
      initial: { y: offsetPx, opacity: 0, scale: scaleEnd },
      animate: { y: 0, opacity: 1, scale: 1 },
      exit: { y: -offsetPx, opacity: 0, scale: scaleEnd },
    };
  }

  return {
    initial: { y: "100%" },
    animate: { y: 0 },
    exit: { y: "-100%" },
  };
}

interface VerticalRollSwapProps {
  activeKey: string;
  items: VerticalRollSwapItem[];
  className?: string;
  heightClassName?: string;
  transition?: Transition;
  /** enterVariant fadeUp 패널 기본값 (아이템별 fadeUp*Transition이 우선) */
  fadeUpTransition?: Transition;
  fadeUpOffsetPx?: number;
  fadeUpScaleEnd?: number;
  /** true면 fadeUp 등장 initial을 생략 (최초 로고 등) */
  skipEnterAnimation?: boolean;
}

function resolveFadeUpTransitions(
  item: VerticalRollSwapItem,
  defaultFadeUpTransition: Transition | undefined,
): { enter: Transition; exit: Transition } {
  const fallback =
    defaultFadeUpTransition ?? COLLAPSE_INTO_HEADER_FADE_UP_PAIR_TRANSITION;
  const enter = item.fadeUpEnterTransition ?? fallback;
  const exit = item.fadeUpExitTransition ?? enter;

  return { enter, exit };
}

function resolveFadeUpOptions(
  item: VerticalRollSwapItem,
  fadeUpOffsetPx?: number,
  fadeUpScaleEnd?: number,
): FadeUpMotionOptions {
  return {
    offsetPx: item.fadeUpOffsetPx ?? fadeUpOffsetPx,
    scaleEnd: item.fadeUpScaleEnd ?? fadeUpScaleEnd,
  };
}

function getActiveItem(items: VerticalRollSwapItem[], activeKey: string) {
  return items.find((item) => item.key === activeKey) ?? items[0];
}

/**
 * 아래→위 세로 롤링으로 패널 전환 (헤더 값 교체 등).
 * `items[].sizer`로 invisible 그리드에 넣으면 너비 점프를 줄일 수 있다.
 */
export default function VerticalRollSwap({
  activeKey,
  items,
  className,
  heightClassName = "h-6",
  transition: transitionProp,
  fadeUpTransition: fadeUpTransitionProp,
  fadeUpOffsetPx,
  fadeUpScaleEnd,
  skipEnterAnimation = false,
}: VerticalRollSwapProps) {
  const shouldReduceMotion = useReducedMotionConfig();
  const activeItem = getActiveItem(items, activeKey);
  const panelMotion = getPanelMotionStates(
    activeItem.enterVariant,
    resolveFadeUpOptions(activeItem, fadeUpOffsetPx, fadeUpScaleEnd),
  );
  const rollTransition = transitionProp ?? VERTICAL_ROLL_SLIDE_TRANSITION;
  const fadeUpTransitions = resolveFadeUpTransitions(
    activeItem,
    fadeUpTransitionProp,
  );
  const enterTransition = shouldReduceMotion
    ? { duration: 0 }
    : activeItem.enterVariant === "fadeUp"
      ? fadeUpTransitions.enter
      : rollTransition;
  const exitTransition = shouldReduceMotion
    ? { duration: 0 }
    : activeItem.enterVariant === "fadeUp"
      ? fadeUpTransitions.exit
      : rollTransition;
  const sizerNodes = items.filter((item) => item.sizer != null);

  return (
    <div className={cn("relative overflow-hidden", heightClassName, className)}>
      {sizerNodes.length > 0 ? (
        <div
          className={cn("invisible grid w-max max-w-full shrink-0", heightClassName)}
          aria-hidden
        >
          {sizerNodes.map((item) => (
            <div
              key={`sizer-${item.key}`}
              className='col-start-1 row-start-1 flex items-center'
            >
              {item.sizer}
            </div>
          ))}
        </div>
      ) : null}

      <AnimatePresence initial={false} mode='sync'>
        <motion.div
          key={activeItem.key}
          initial={skipEnterAnimation ? false : panelMotion.initial}
          animate={panelMotion.animate}
          exit={{ ...panelMotion.exit, transition: exitTransition }}
          transition={enterTransition}
          style={
            activeItem.enterVariant === "fadeUp"
              ? { transformOrigin: "top left" }
              : undefined
          }
          className={cn(
            "absolute inset-0 flex items-center overflow-hidden",
            activeItem.panelClassName,
          )}
        >
          {activeItem.children}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

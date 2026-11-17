"use client";

import type { ReactNode } from "react";
import { motion, useReducedMotionConfig } from "framer-motion";

import {
  PAGE_SLIDE_GPU_LAYER_CLASS,
  PAGE_SLIDE_INITIAL,
  pageSlideTransition,
} from "./animations/pageEntranceMotion";
import { usePageSlideEntranceMotion } from "./animations/usePageSlideEntranceMotion";
import { cn } from "./cn";

interface PageSlideEntranceProps {
  children: ReactNode;
  className?: string;
}

/**
 * 페이지 본문 전체를 한 덩어리로 위→아래 슬라이드하며 등장시킨다.
 * - 이중 rAF(`runAfterPaint`)로 첫 페인트 이후 애니메이션 시작
 * - GPU 레이어·will-change는 애니메이션 구간에만 적용 후 해제
 * - `LazyMotion strict`는 자식 트리의 `motion` 컴포넌트와 충돌하므로 사용하지 않는다.
 * Server Component 자식을 children으로 넘기면 RSC 경계를 유지할 수 있다.
 */
export function PageSlideEntrance({ children, className }: PageSlideEntranceProps) {
  const shouldReduceMotion = useReducedMotionConfig();
  const { animate, willChange, handleAnimationComplete } =
    usePageSlideEntranceMotion();

  if (shouldReduceMotion) {
    return <div className={cn(className)}>{children}</div>;
  }

  return (
    <motion.div
      className={cn(PAGE_SLIDE_GPU_LAYER_CLASS, className)}
      initial={PAGE_SLIDE_INITIAL}
      animate={animate}
      transition={pageSlideTransition()}
      onAnimationComplete={handleAnimationComplete}
      style={willChange ? { willChange } : undefined}
    >
      {children}
    </motion.div>
  );
}

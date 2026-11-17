"use client";

import type { ReactNode } from "react";
import { motion, useReducedMotionConfig, type Transition } from "framer-motion";

import { cn } from "./cn";

import {
  COLLAPSE_INTO_HEADER_COLLAPSE_TRANSITION,
  COLLAPSE_INTO_HEADER_EXPAND_TRANSITION,
  DEFAULT_COLLAPSE_INTO_HEADER_OFFSET_PX,
  DEFAULT_COLLAPSE_INTO_HEADER_SCALE_END,
} from "./verticalRollSlide.motion";

interface CollapseIntoHeaderMotionProps {
  children: ReactNode;
  /** true면 헤더 쪽으로 올라간 상태 */
  isCollapsed: boolean;
  offsetPx?: number;
  scaleEnd?: number;
  collapseTransition?: Transition;
  expandTransition?: Transition;
  className?: string;
  /** collapse 애니메이션 완료 시 (isCollapsed === true일 때만) */
  onCollapsedComplete?: () => void;
}

/**
 * 스크롤 등으로 `isCollapsed`가 켜지면 본문 블록이 헤더 방향으로 올라가며 fade-out.
 * transform·opacity만 사용해 레이아웃·스크롤 옵저버 피드백 루프를 피한다.
 */
export default function CollapseIntoHeaderMotion({
  children,
  isCollapsed,
  offsetPx = DEFAULT_COLLAPSE_INTO_HEADER_OFFSET_PX,
  scaleEnd = DEFAULT_COLLAPSE_INTO_HEADER_SCALE_END,
  collapseTransition = COLLAPSE_INTO_HEADER_COLLAPSE_TRANSITION,
  expandTransition = COLLAPSE_INTO_HEADER_EXPAND_TRANSITION,
  className,
  onCollapsedComplete,
}: CollapseIntoHeaderMotionProps) {
  const shouldReduceMotion = useReducedMotionConfig();
  const collapseOffset = -offsetPx;
  const resolvedTransition = shouldReduceMotion
    ? { duration: 0 }
    : isCollapsed
      ? collapseTransition
      : expandTransition;

  return (
    <motion.div
      className={cn("will-change-transform", className)}
      initial={false}
      animate={{
        y: isCollapsed ? collapseOffset : 0,
        scale: isCollapsed ? scaleEnd : 1,
        opacity: isCollapsed ? 0 : 1,
      }}
      transition={resolvedTransition}
      onAnimationComplete={() => {
        if (isCollapsed) {
          onCollapsedComplete?.();
        }
      }}
      style={{
        transformOrigin: "top left",
        pointerEvents: isCollapsed ? "none" : undefined,
      }}
    >
      {children}
    </motion.div>
  );
}

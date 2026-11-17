"use client";

import type { CSSProperties, ReactNode } from "react";
import { motion, useReducedMotionConfig } from "framer-motion";

import {
  ENTRANCE_STYLE_CHILD_ANIMATE,
  ENTRANCE_STYLE_CHILD_INITIAL,
  ENTRANCE_STYLE_CONTAINER_ANIMATE,
  ENTRANCE_STYLE_CONTAINER_INITIAL,
  ENTRANCE_STYLE_DELAY,
  ENTRANCE_STYLE_HORIZONTAL_ANIMATE,
  ENTRANCE_STYLE_HORIZONTAL_INITIAL,
  entranceStyleChildTransition,
  entranceStyleContainerTransition,
} from "./animations/entranceStyleMotion";
import { cn } from "./cn";

interface EntrancePanelProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}

/** 카드·패널 전체 — 위에서 살짝 내려오며 등장 */
export function EntrancePanel({ children, className, style }: EntrancePanelProps) {
  const shouldReduceMotion = useReducedMotionConfig();

  if (shouldReduceMotion) {
    return (
      <div className={className} style={style}>
        {children}
      </div>
    );
  }

  return (
    <motion.div
      className={cn(className)}
      style={style}
      initial={ENTRANCE_STYLE_CONTAINER_INITIAL}
      animate={ENTRANCE_STYLE_CONTAINER_ANIMATE}
      transition={entranceStyleContainerTransition()}
    >
      {children}
    </motion.div>
  );
}

interface EntranceItemProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** 등장 delay(초) */
  delay?: number;
}

/** 스탬프·라벨 등 자식 블록 — opacity + y + scale */
export function EntranceItem({
  children,
  className,
  style,
  delay = 0,
}: EntranceItemProps) {
  const shouldReduceMotion = useReducedMotionConfig();

  if (shouldReduceMotion) {
    return (
      <div className={className} style={style}>
        {children}
      </div>
    );
  }

  return (
    <motion.div
      className={cn(className)}
      style={style}
      initial={ENTRANCE_STYLE_CHILD_INITIAL}
      animate={ENTRANCE_STYLE_CHILD_ANIMATE}
      transition={entranceStyleChildTransition(delay)}
    >
      {children}
    </motion.div>
  );
}

interface EntranceHorizontalRevealProps {
  className?: string;
  style?: CSSProperties;
  delay?: number;
  "aria-hidden"?: boolean;
  "data-testid"?: string;
}

/** 점선·구분선 — scaleX + opacity */
export function EntranceHorizontalReveal({
  className,
  style,
  delay = ENTRANCE_STYLE_DELAY.connector,
  ...rest
}: EntranceHorizontalRevealProps) {
  const shouldReduceMotion = useReducedMotionConfig();

  if (shouldReduceMotion) {
    return <div className={className} style={style} {...rest} />;
  }

  return (
    <motion.div
      className={cn(className)}
      style={{ transformOrigin: "center center", ...style }}
      initial={ENTRANCE_STYLE_HORIZONTAL_INITIAL}
      animate={ENTRANCE_STYLE_HORIZONTAL_ANIMATE}
      transition={entranceStyleChildTransition(delay)}
      {...rest}
    />
  );
}

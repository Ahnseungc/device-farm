"use client";

import type { ReactNode } from "react";
import { LazyMotion, domAnimation, m, useReducedMotionConfig } from "framer-motion";

import { ENTRANCE_STYLE_EASE, ENTRANCE_STYLE_DURATION } from "./animations/entranceStyleMotion";
import { cn } from "./cn";

interface TextEntranceProps {
  children: ReactNode;
  className?: string;
  delay?: number;
  y?: number;
  /** 1회 등장 시간(초). 기본 `ENTRANCE_STYLE_DURATION.list` — 아이콘처럼 천천히 올릴 때 늘린다 */
  duration?: number;
  repeat?: boolean;
  repeatDuration?: number;
}

/**
 * 로딩/안내 문구에 재사용하는 토스 스타일 텍스트 등장 애니메이션.
 */
export default function TextEntrance({
  children,
  className,
  delay = 0,
  y = 8,
  duration = ENTRANCE_STYLE_DURATION.list,
  repeat = false,
  repeatDuration = 2.2,
}: TextEntranceProps) {
  const reducedMotion = useReducedMotionConfig();

  if (reducedMotion) {
    return <div className={cn(className)}>{children}</div>;
  }

  return (
    <LazyMotion features={domAnimation}>
      <m.div
        className={cn(className)}
        initial={{ opacity: 0, y }}
        animate={repeat ? { opacity: [0, 1, 1, 0], y: [y, 0, 0, -y] } : { opacity: 1, y: 0 }}
        transition={
          repeat
            ? {
                delay,
                duration: repeatDuration,
                times: [0, 0.2, 0.75, 1],
                ease: "easeInOut",
                repeat: Infinity,
                repeatDelay: 0.3,
              }
            : {
                delay,
                duration,
                ease: ENTRANCE_STYLE_EASE,
              }
        }
        style={{ willChange: "transform, opacity" }}
      >
        {children}
      </m.div>
    </LazyMotion>
  );
}

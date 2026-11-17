"use client";

import { motion, useReducedMotionConfig } from "framer-motion";
import { useEffect, useRef, useState } from "react";

import {
  GLOSS_SWEEP_DURATION_S,
  GLOSS_SWEEP_SEGMENT_EASE,
  GLOSS_SWEEP_START_LEFT_PX,
  GLOSS_SWEEP_TIMES,
  resolveGlossSweepRepeat,
  resolveGlossSweepTranslateXPx,
} from "./animations/glossSweepMotion";
import { cn } from "./cn";
import { useMotionTier } from "./motion-tier";

interface GlossSweepHighlightProps {
  className?: string;
  /** false면 미렌더 (부모 visible 등과 연동) */
  enabled?: boolean;
}

/**
 * 메탈릭/그라데이션 배지용 공통 gloss 스윕.
 * 부모에 `relative overflow-hidden` 필요.
 * mix-blend-plus-lighter · 내부 strip opacity-40 + blur-[2px].
 */
export default function GlossSweepHighlight({
  className,
  enabled = true,
}: GlossSweepHighlightProps) {
  const shouldReduceMotion = useReducedMotionConfig();
  const motionTier = useMotionTier();
  const stripRef = useRef<HTMLDivElement>(null);
  /**
   * 부모 폭을 재서 스윕 거리를 정한다.
   * 마운트 후 시작해야 `AnimatePresence initial={false}` 안에서 억제되지 않는다.
   */
  const [translateXPx, setTranslateXPx] = useState<number | null>(null);

  useEffect(() => {
    const parentWidthPx = stripRef.current?.parentElement?.offsetWidth ?? 0;
    setTranslateXPx(resolveGlossSweepTranslateXPx(parentWidthPx));
  }, []);

  if (!enabled || shouldReduceMotion || motionTier === "minimal") return null;

  return (
    <motion.div
      ref={stripRef}
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-y-0 z-10 w-6",
        "mix-blend-plus-lighter",
        className,
      )}
      style={{ left: GLOSS_SWEEP_START_LEFT_PX }}
      animate={
        translateXPx === null ? { x: 0 } : { x: [0, translateXPx, translateXPx] }
      }
      transition={{
        duration: GLOSS_SWEEP_DURATION_S,
        times: [...GLOSS_SWEEP_TIMES],
        ease: [...GLOSS_SWEEP_SEGMENT_EASE],
        repeat: resolveGlossSweepRepeat(motionTier),
      }}
    >
      <div className='h-full w-full bg-white opacity-40 blur-[2px]' />
    </motion.div>
  );
}

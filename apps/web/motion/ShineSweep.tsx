"use client";

import { motion, useReducedMotionConfig } from "framer-motion";
import { useEffect, useRef, useState } from "react";

import { cn } from "./cn";

/*
 * 빛 띠 스윕 — @toss/tds-react-native 2.0.5 `components/list-row/animation/useShineAnimation`·`ShineEffect`(light) 를 웹으로 옮겼다.
 * Licensed under the Apache License, Version 2.0 — 원문: components/cash-amount-input/AmountKeypad/LICENSE.tds-react-native.txt
 * 변경: 부모 크기를 마운트 때 한 번 잰다. 흰색은 `text-white` 의 currentColor, dark 모드 변형은 넣지 않았다.
 */

/** 한 번 지나가는 시간(s) */
const SHINE_SWEEP_DURATION_S = 2.2;
/** 다음 스윕 전 쉬는 시간(s) */
const SHINE_REPEAT_DELAY_S = 0.1;
const SHINE_EASE = [0.7, 0, 0.7, 1] as const;
/** 빛 띠 정사각형 한 변 = 부모 높이 × 3 */
const SHINE_BAND_HEIGHT_RATIO = 3;
/** 140° · 흰색 0 → 0.8 → 0 (30% / 50% / 70%) */
const SHINE_GRADIENT =
  "linear-gradient(140deg, transparent 30%, color-mix(in srgb, currentColor 80%, transparent) 50%, transparent 70%)";

interface ParentSize {
  width: number;
  height: number;
}

interface ShineSweepProps {
  className?: string;
  /** false 면 그리지 않는다 */
  enabled?: boolean;
  /** 반복 횟수. 기본 무한 */
  iterations?: number;
}

/**
 * 카드·행 위를 대각선 흰 빛 띠가 왼쪽 → 오른쪽으로 쓸고 지나간다.
 * 부모에 `relative overflow-hidden` 이 필요하다.
 */
export default function ShineSweep({
  className,
  enabled = true,
  iterations = Infinity,
}: ShineSweepProps) {
  const shouldReduceMotion = useReducedMotionConfig();
  const bandRef = useRef<HTMLSpanElement>(null);
  const [parentSize, setParentSize] = useState<ParentSize | null>(null);

  useEffect(() => {
    const parent = bandRef.current?.parentElement;
    if (!parent) return;
    setParentSize({ width: parent.offsetWidth, height: parent.offsetHeight });
  }, []);

  if (!enabled || shouldReduceMotion) return null;

  const bandSizePx = (parentSize?.height ?? 0) * SHINE_BAND_HEIGHT_RATIO;
  const repeatCount = iterations === Infinity ? Infinity : Math.max(iterations - 1, 0);

  return (
    <motion.span
      ref={bandRef}
      data-testid='shine-sweep'
      aria-hidden
      className={cn("pointer-events-none absolute top-0 left-0 text-white", className)}
      style={{
        width: bandSizePx,
        height: bandSizePx,
        y: -(parentSize?.height ?? 0),
        backgroundImage: SHINE_GRADIENT,
      }}
      initial={{ x: -bandSizePx }}
      animate={parentSize ? { x: [-bandSizePx, parentSize.width] } : undefined}
      transition={{
        duration: SHINE_SWEEP_DURATION_S,
        ease: SHINE_EASE,
        repeat: repeatCount,
        repeatDelay: SHINE_REPEAT_DELAY_S,
      }}
    />
  );
}

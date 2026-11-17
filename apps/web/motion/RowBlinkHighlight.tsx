"use client";

import { AbortError, delay } from "es-toolkit";
import { motion, useReducedMotionConfig, type Transition } from "framer-motion";
import { useEffect, useState, type ReactNode } from "react";

import { MOTION_SPRING } from "./animations/motionTokens";
import { cn } from "./cn";

/*
 * 행 깜빡임 — @toss/tds-react-native 2.0.5 `components/list-row/animation/useBlinkAnimation`·`BlinkEffect` 를 웹으로 옮겼다.
 * Licensed under the Apache License, Version 2.0 — 원문: components/cash-amount-input/AmountKeypad/LICENSE.tds-react-native.txt
 * 변경: start 후 `holdMs` 가 지나면 자동으로 exit 한다. 원형 그라데이션은 행 가운데 정사각형으로 두고 scale 만 키운다.
 *       색은 `tone` 토큰의 currentColor (기본 `fill-status-blue`).
 */

/**
 * 빛·틴트 — 그라데이션은 `glow` 의 currentColor 를 `glowMixPercent` 만큼, 틴트는 `tint` 를 `tintOpacity` 로 깐다.
 * - blue: TDS 그대로 (파랑 10% 빛 · 4% 틴트)
 * - gray: 가장 진할 때도 DS hover 회색(`gray100`) — 행에 손을 올린 정도로만 보인다. 다크는 gray100 이 다크 hover 값
 */
const BLINK_TONE = {
  blue: { glow: "text-fill-status-blue", glowMixPercent: 10, tint: "bg-fill-status-blue", tintOpacity: 0.04 },
  gray: {
    glow: "text-fill-grayscale-gray100",
    glowMixPercent: 100,
    tint: "bg-fill-grayscale-gray100",
    tintOpacity: 1,
  },
} as const;

export type RowBlinkTone = keyof typeof BLINK_TONE;

/** 행이 살짝 커지는 크기 */
const BLINK_SCALE_PEAK = 1.02;
/** TDS 가 직접 적은 spring (프리셋 아님) */
const BLINK_SCALE_UP_SPRING = { type: "spring", stiffness: 766, damping: 52 } as const;
/** 틴트가 늦게 깔리는 시간(s) */
const BLINK_DIM_DELAY_S = 0.48;
/** 그라데이션이 시작하는 시간(s) */
const BLINK_GRADIENT_DELAY_S = 0.02;
/** start 뒤 exit 까지 유지(ms) */
export const ROW_BLINK_DEFAULT_HOLD_MS = 1200;

type BlinkPhase = "idle" | "start" | "end";

function resolveScaleTransition(phase: BlinkPhase, scalePeaked: boolean): Transition {
  if (phase === "end") return MOTION_SPRING.quick;
  return scalePeaked ? MOTION_SPRING.slow : BLINK_SCALE_UP_SPRING;
}

interface RowBlinkHighlightProps {
  children: ReactNode;
  /** 값이 바뀔 때마다 깜빡임을 다시 재생한다. undefined 면 재생하지 않는다 */
  playKey?: string | number;
  /** start 뒤 exit 까지 유지(ms) */
  holdMs?: number;
  /** 빛·틴트 색 (기본 파랑) */
  tone?: RowBlinkTone;
  className?: string;
}

/** 리스트 행을 한 번 깜빡여 강조한다 (새로 추가·변경된 행 안내) */
export default function RowBlinkHighlight({
  children,
  playKey,
  holdMs = ROW_BLINK_DEFAULT_HOLD_MS,
  tone = "blue",
  className,
}: RowBlinkHighlightProps) {
  const toneStyle = BLINK_TONE[tone];
  const shouldReduceMotion = useReducedMotionConfig() === true;
  const [phase, setPhase] = useState<BlinkPhase>("idle");
  const [scalePeaked, setScalePeaked] = useState(false);

  useEffect(() => {
    if (playKey === undefined || shouldReduceMotion) return;
    const controller = new AbortController();
    setPhase("start");
    setScalePeaked(false);
    void delay(holdMs, { signal: controller.signal }).then(
      () => setPhase("end"),
      (error: unknown) => {
        // playKey 가 바뀌거나 언마운트돼 취소된 경우 — 다음 재생이 이어받는 정상 흐름
        if (!(error instanceof AbortError)) throw error;
      },
    );
    return () => controller.abort();
  }, [playKey, holdMs, shouldReduceMotion]);

  const isStart = phase === "start";
  const scaleTarget = isStart && !scalePeaked ? BLINK_SCALE_PEAK : 1;
  // 1.02 로 튀었다가(766/52) slow 로 천천히 1 로 돌아온다. exit 은 quick
  const scaleTransition: Transition = resolveScaleTransition(phase, scalePeaked);

  return (
    <motion.div
      data-testid='row-blink'
      data-phase={phase}
      // isolate — 빛·틴트를 이 행 안에서만 글자 뒤로 보낸다
      className={cn("relative isolate overflow-hidden", className)}
      initial={false}
      animate={{ scale: scaleTarget }}
      transition={scaleTransition}
      onAnimationComplete={() => {
        if (isStart && !scalePeaked) setScalePeaked(true);
      }}
    >
      {/* ⭐빛·틴트는 내용 뒤에 깐다 — 위에 덮으면 진한 색(gray)에서 글자가 가려진다 */}
      <div className='relative z-[1]'>{children}</div>
      {phase === "idle" ? null : (
        <>
          <motion.span
            aria-hidden
            className={cn(
              "pointer-events-none absolute inset-x-0 top-1/2 z-0 aspect-square -translate-y-1/2",
              toneStyle.glow,
            )}
            style={{
              backgroundImage:
                `radial-gradient(closest-side, color-mix(in srgb, currentColor ${toneStyle.glowMixPercent}%, transparent), transparent)`,
            }}
            initial={{ opacity: 0, scale: 0 }}
            animate={isStart ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 1 }}
            transition={
              isStart
                ? {
                    opacity: { ...MOTION_SPRING.basic, delay: BLINK_GRADIENT_DELAY_S },
                    scale: { ...MOTION_SPRING.slow, delay: BLINK_GRADIENT_DELAY_S },
                  }
                : MOTION_SPRING.slow
            }
          />
          <motion.span
            aria-hidden
            className={cn("pointer-events-none absolute inset-0 z-0", toneStyle.tint)}
            initial={{ opacity: 0 }}
            animate={{ opacity: isStart ? toneStyle.tintOpacity : 0 }}
            transition={
              isStart ? { ...MOTION_SPRING.basic, delay: BLINK_DIM_DELAY_S } : MOTION_SPRING.slow
            }
          />
        </>
      )}
    </motion.div>
  );
}

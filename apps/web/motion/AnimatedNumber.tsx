"use client";

import {
  animate,
  motion,
  useMotionValue,
  useReducedMotionConfig,
  useTransform,
} from "framer-motion";
import { useEffect, type ReactNode } from "react";

import { ENTRANCE_STYLE_EASE } from "./animations/entranceStyleMotion";
import {
  shouldPlayCountUpFade,
  SMOOTH_COUNT_UP_EASE,
  SMOOTH_COUNT_UP_FADE_OPACITY_FROM,
  SMOOTH_COUNT_UP_FADE_Y_PX,
  scaleCountUpDurationByTier,
} from "./animations/smoothCountUp";
import { useMotionTier } from "./motion-tier";

interface AnimatedNumberProps {
  value: number;
  fractionDigits?: number;
  useGrouping?: boolean;
  className?: string;
  duration?: number;
  /**
   * 지정 시 `fractionDigits` / `useGrouping` 대신 이 함수로 표시 문자열을 만든다.
   */
  formatValue?: (n: number) => string;
  /**
   * `formatValue` 사용 시: 표시·애니메이션 목표값을 이 소수 자릿수에서 반올림한다.
   * (중간 프레임 부동소수점으로 최대 소수 자릿수를 넘기지 않게 할 때 지정)
   */
  formatInputSnapDecimals?: number;
  /**
   * true면 마운트 시 motion 값이 0에서 시작해 `value`로 애니메이션한다.
   * 이후 `value` 변경은 현재 표시 값에서 새 값으로 이어진다.
   */
  countFromZero?: boolean;
  /** `duration` > 0일 때 애니메이션 시작 숫자(미지정 시 현재 motion 값에서 이어짐) */
  animateFrom?: number;
  /** 카운트업 이징. 기본 `SMOOTH_COUNT_UP_EASE` */
  ease?: (t: number) => number;
  children?: ReactNode;
}

function snapToDecimals(n: number, decimals: number): number {
  if (!Number.isFinite(n) || decimals < 0) return n;
  const p = 10 ** decimals;
  return Math.round(n * p) / p;
}

export default function AnimatedNumber({
  value,
  fractionDigits = 0,
  useGrouping = true,
  className,
  duration: baseDuration = 0.55,
  formatValue,
  formatInputSnapDecimals,
  countFromZero = false,
  animateFrom,
  ease = SMOOTH_COUNT_UP_EASE,
  children,
}: AnimatedNumberProps) {
  const shouldReduceMotion = useReducedMotionConfig();
  // SmoothCountUpNumber 도 이 컴포넌트를 거치므로 등급 분기는 여기 한 곳에서만 한다
  const motionTier = useMotionTier();
  const duration = scaleCountUpDurationByTier(baseDuration, motionTier);
  const snappedValue =
    formatValue != null && formatInputSnapDecimals != null
      ? snapToDecimals(value, formatInputSnapDecimals)
      : value;

  const initialValue =
    duration > 0 && animateFrom != null && Number.isFinite(animateFrom)
      ? animateFrom
      : countFromZero
        ? 0
        : snappedValue;
  const motionValue = useMotionValue(initialValue);
  const shouldFade = shouldPlayCountUpFade({
    durationSec: duration,
    target: snappedValue,
    animateFrom,
    countFromZero,
    reduceMotion: shouldReduceMotion,
  });

  const displayValue = useTransform(motionValue, (latest) => {
    const safeLatest = Number.isFinite(latest) ? latest : 0;
    if (formatValue) {
      const n =
        formatInputSnapDecimals != null
          ? snapToDecimals(safeLatest, formatInputSnapDecimals)
          : safeLatest;
      return formatValue(n);
    }
    return safeLatest.toLocaleString("ko-KR", {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
      useGrouping,
    });
  });

  useEffect(() => {
    if (duration > 0 && animateFrom != null && Number.isFinite(animateFrom)) {
      motionValue.set(animateFrom);
    }
    const controls = animate(motionValue, snappedValue, {
      duration,
      ease,
    });
    return () => controls.stop();
  }, [motionValue, snappedValue, duration, animateFrom, ease]);

  return (
    <motion.span
      className={className}
      initial={
        shouldFade
          ? {
              opacity: SMOOTH_COUNT_UP_FADE_OPACITY_FROM,
              y: SMOOTH_COUNT_UP_FADE_Y_PX,
            }
          : false
      }
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: shouldFade ? duration : 0,
        ease: ENTRANCE_STYLE_EASE,
      }}
      style={{
        willChange: shouldFade ? "transform, opacity" : undefined,
      }}
    >
      {/* MotionValue는 motion 노드의 단독 자식일 때만 텍스트로 렌더된다 */}
      <motion.span style={{ willChange: "contents" }}>{displayValue}</motion.span>
      {children}
    </motion.span>
  );
}

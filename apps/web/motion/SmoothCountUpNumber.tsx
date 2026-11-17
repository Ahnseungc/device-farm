"use client";

import AnimatedNumber from "./AnimatedNumber";
import { cn } from "./cn";

interface SmoothCountUpNumberProps {
  value: number;
  animateFrom?: number;
  durationSec?: number;
  className?: string;
  suffix?: string;
  fractionDigits?: number;
  useGrouping?: boolean;
  formatValue?: (n: number) => string;
  formatInputSnapDecimals?: number;
  ease?: (t: number) => number;
}

/** 토스형 부드러운 숫자 카운트업 — 금액·포인트 등 정수 표시용 */
export function SmoothCountUpNumber({
  value,
  animateFrom,
  durationSec = 0,
  className,
  suffix,
  fractionDigits = 0,
  useGrouping = true,
  formatValue,
  formatInputSnapDecimals,
  ease,
}: SmoothCountUpNumberProps) {
  const shouldAnimate =
    animateFrom != null && Number.isFinite(animateFrom) && animateFrom !== value;

  return (
    <AnimatedNumber
      className={cn("inline-flex items-baseline tabular-nums", className)}
      value={value}
      animateFrom={shouldAnimate ? animateFrom : undefined}
      duration={shouldAnimate ? durationSec : 0}
      fractionDigits={fractionDigits}
      useGrouping={useGrouping}
      formatValue={formatValue}
      formatInputSnapDecimals={formatInputSnapDecimals}
      ease={ease}
    >
      {suffix ? <span className="shrink-0">{suffix}</span> : null}
    </AnimatedNumber>
  );
}

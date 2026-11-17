"use client";

import { motion, useReducedMotionConfig } from "framer-motion";

import { cn } from "./cn";

/** 깜빡임 한 주기(초) — 반은 보이고 반은 숨는다 */
const CARET_BLINK_DURATION_S = 1;

interface BlinkingCaretProps {
  className?: string;
}

/**
 * 깜빡이는 입력 커서 — 입력칸 없이 값을 보여줄 때(커스텀 키패드 등) 쓴다.
 * 입력칸 기본 커서처럼 글자색을 따라간다(`bg-current`). 모션 줄이기면 그리지 않는다.
 */
export function BlinkingCaret({ className }: BlinkingCaretProps) {
  const shouldReduceMotion = useReducedMotionConfig();
  if (shouldReduceMotion) return null;

  return (
    <motion.span
      aria-hidden='true'
      className={cn("mx-px inline-block h-[1em] w-0.5 self-center bg-current", className)}
      animate={{ opacity: [1, 1, 0, 0] }}
      transition={{ duration: CARET_BLINK_DURATION_S, repeat: Infinity, times: [0, 0.5, 0.5, 1] }}
    />
  );
}

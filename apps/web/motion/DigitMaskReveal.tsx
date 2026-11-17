"use client";

import { motion, useReducedMotionConfig } from "framer-motion";

import { ENTRANCE_STYLE_EASE } from "./animations/entranceStyleMotion";
import { cn } from "./cn";

/** 글자 하나가 마스크 아래에서 올라오는 시간(초) */
export const DIGIT_MASK_REVEAL_DURATION_S = 0.56;

/** 앞 글자 대비 다음 글자 시작 간격(초) — 짧게 겹쳐 한 덩어리처럼 흐르게 */
export const DIGIT_MASK_REVEAL_STAGGER_S = 0.035;

/** 마지막 글자까지 다 올라오는 시간(초) — 다음 요소를 이어서 등장시킬 때 delay 로 쓴다 */
export function getDigitMaskRevealEndS(text: string, delay = 0): number {
  const lastIndex = Math.max(Array.from(text).length - 1, 0);
  return delay + lastIndex * DIGIT_MASK_REVEAL_STAGGER_S + DIGIT_MASK_REVEAL_DURATION_S;
}

interface DigitMaskRevealProps {
  /** 보여줄 숫자 문자열 (예: `47,000`). 단위(`원`)는 밖에 둔다 */
  text: string;
  className?: string;
  /** 첫 글자 시작 delay(초) */
  delay?: number;
}

/**
 * 토스형 숫자 등장 — 글자마다 마스크(overflow hidden)로 감싸고 아래에서 위로 올라오며 스태거.
 * 스크린리더는 전체 문자열 한 번만 읽는다.
 */
export function DigitMaskReveal({ text, className, delay = 0 }: DigitMaskRevealProps) {
  const shouldReduceMotion = useReducedMotionConfig();

  if (shouldReduceMotion) {
    return <span className={className}>{text}</span>;
  }

  return (
    <span className={cn("inline-flex tabular-nums", className)} aria-label={text} role='text'>
      {Array.from(text).map((char, index) => (
        <span key={`${index}-${char}`} aria-hidden='true' className='inline-block overflow-hidden'>
          <motion.span
            className='inline-block will-change-transform'
            initial={{ y: "100%", opacity: 0 }}
            animate={{ y: "0%", opacity: 1 }}
            transition={{
              duration: DIGIT_MASK_REVEAL_DURATION_S,
              ease: ENTRANCE_STYLE_EASE,
              delay: delay + index * DIGIT_MASK_REVEAL_STAGGER_S,
            }}
          >
            {char}
          </motion.span>
        </span>
      ))}
    </span>
  );
}

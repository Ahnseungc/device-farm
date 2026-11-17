"use client";

import { motion, useReducedMotionConfig, type Transition } from "framer-motion";

import { MOTION_SPRING } from "./animations/motionTokens";
import { cn } from "./cn";

const DIGITS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;
const DIGIT_COUNT = DIGITS.length;
const PERCENT = 100;

/** 자릿수가 다음 숫자까지 굴러가는 움직임 — 큰 폭(2→9)도 한 번에 멈추게 출렁임 없는 spring */
export const ROLLING_DIGIT_TRANSITION: Transition = MOTION_SPRING.basic;

interface RollingDigitsProps {
  /** 보여줄 문자열 (예: `712,422원`). 숫자만 굴러가고 콤마·단위는 그대로 */
  text: string;
  className?: string;
}

const isDigit = (char: string) => char >= "0" && char <= "9";

/**
 * 토스형 숫자 룰렛 — 값이 바뀌면 자릿수마다 0~9 띠가 위아래로 굴러 새 숫자에 멈춘다.
 * 바뀌지 않은 자릿수는 그대로, 처음 그릴 때는 굴리지 않는다.
 *
 * - 자릿수는 **오른쪽 끝부터** 짝짓는다 — `9,999원 → 10,000원` 처럼 길이가 바뀌어도 일·십의 자리가 그대로 맞물린다.
 * - 글자 폭은 `tabular-nums` 고정이라 굴러가는 동안 옆 글자가 흔들리지 않는다.
 * - 스크린리더는 전체 문자열 한 번만 읽는다.
 */
export function RollingDigits({ text, className }: RollingDigitsProps) {
  const shouldReduceMotion = useReducedMotionConfig();
  const chars = Array.from(text);

  if (shouldReduceMotion) return <span className={cn("tabular-nums", className)}>{text}</span>;

  return (
    <span className={cn("inline-flex tabular-nums", className)}>
      <span className='sr-only'>{text}</span>
      {chars.map((char, index) => {
        // 오른쪽에서 몇 번째 글자인지로 key — 길이가 바뀌어도 같은 자리끼리 이어서 굴러간다
        const key = `${chars.length - index}`;
        return isDigit(char) ? (
          <RollingDigit key={key} digit={Number(char)} />
        ) : (
          <span key={key} aria-hidden='true'>
            {char}
          </span>
        );
      })}
    </span>
  );
}

function RollingDigit({ digit }: { digit: number }) {
  return (
    <span aria-hidden='true' className='relative inline-block overflow-hidden'>
      {/* 폭·높이는 보이지 않는 글자 하나로 잡는다 */}
      <span className='invisible'>0</span>
      <motion.span
        className='absolute inset-x-0 top-0 flex flex-col will-change-transform'
        initial={false}
        animate={{ y: `${(-digit * PERCENT) / DIGIT_COUNT}%` }}
        transition={ROLLING_DIGIT_TRANSITION}
      >
        {DIGITS.map((d) => (
          <span key={d}>{d}</span>
        ))}
      </motion.span>
    </span>
  );
}

"use client";

import { motion, useReducedMotionConfig } from "framer-motion";
import type { ReactNode } from "react";

import {
  attentionEffect,
  type AttentionEffectName,
  type AttentionEffectOptions,
} from "./animations/attentionEffect";

interface AttentionEffectProps extends AttentionEffectOptions {
  name: AttentionEffectName;
  /** 바뀔 때마다 효과를 다시 재생한다 (탭 횟수 등). 0 이면 재생하지 않는다 */
  playKey: number;
  children: ReactNode;
  className?: string;
}

/**
 * TDS 강조 효과(`attentionEffect`)를 감싼 인라인 블록(inline-flex). `ripple` 은 겹친 복제본을 퍼뜨린다.
 * 모션 줄이기면 재생하지 않는다.
 */
export function AttentionEffect({
  name,
  playKey,
  children,
  className,
  ...options
}: AttentionEffectProps) {
  const shouldReduceMotion = useReducedMotionConfig();
  const isPlaying = playKey > 0 && !shouldReduceMotion;

  if (name === "ripple") {
    return (
      <span className={className} style={{ position: "relative", display: "inline-flex" }}>
        {children}
        {isPlaying ? (
          <motion.span
            key={playKey}
            aria-hidden
            className='pointer-events-none absolute inset-0'
            initial={{ scale: 1, opacity: 1 }}
            {...attentionEffect("ripple", options)}
          >
            {children}
          </motion.span>
        ) : null}
      </span>
    );
  }

  return (
    <motion.span
      key={playKey}
      className={className}
      // inline-flex — inline-block 이면 안쪽 inline-flex 글자에 기준선 여백이 붙어 높이가 달라진다
      style={{ display: "inline-flex" }}
      {...(isPlaying ? attentionEffect(name, options) : {})}
    >
      {children}
    </motion.span>
  );
}

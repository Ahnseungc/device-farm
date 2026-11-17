"use client";

import { motion, useReducedMotionConfig } from "framer-motion";
import type { ReactNode } from "react";

import { revealMotion, type RevealName, type RevealOptions } from "./animations/revealMotion";

interface RevealProps extends RevealOptions {
  name: RevealName;
  children: ReactNode;
  className?: string;
}

/**
 * TDS 등장·퇴장 프리셋(`revealMotion`)을 감싼 블록. `AnimatePresence` 안에 두면 퇴장도 재생한다.
 * 모션 줄이기면 바로 보인다.
 */
export function Reveal({ name, children, className, ...options }: RevealProps) {
  const shouldReduceMotion = useReducedMotionConfig();
  if (shouldReduceMotion) return <div className={className}>{children}</div>;

  return (
    <motion.div className={className} {...revealMotion(name, options)}>
      {children}
    </motion.div>
  );
}

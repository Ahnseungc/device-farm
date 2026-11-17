"use client";

import type { ReactNode } from "react";
import { motion } from "framer-motion";

interface ExpandFadeRevealProps {
  children: ReactNode;
  revealTopPadding?: number;
  className?: string;
}

const DEFAULT_TRANSITION = { duration: 0.3, ease: [0.25, 0.1, 0.25, 1] as const };

export default function ExpandFadeReveal({
  children,
  revealTopPadding = 0,
  className,
}: ExpandFadeRevealProps) {
  return (
    <motion.div
      initial={{ height: 0, opacity: 0, paddingTop: 0 }}
      animate={{ height: "auto", opacity: 1, paddingTop: revealTopPadding }}
      exit={{ height: 0, opacity: 0, paddingTop: 0 }}
      transition={DEFAULT_TRANSITION}
      className={className}
    >
      {children}
    </motion.div>
  );
}

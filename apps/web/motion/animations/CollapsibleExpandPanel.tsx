"use client";

import { motion } from "framer-motion";
import type { ReactNode } from "react";

import { COLLAPSIBLE_CARD_PRESENCE_INITIAL } from "./collapsibleCardMotion";
import {
  COLLAPSIBLE_HEIGHT_CONTENT_VARIANTS,
  COLLAPSIBLE_HEIGHT_TRANSITION,
} from "./collapsibleHeightMotion";
import { cn } from "../cn";

interface CollapsibleExpandPanelProps {
  isOpen: boolean;
  children: ReactNode;
  /** 펼침 시 왼쪽 세로선이 위→아래로 그려지는 효과 */
  showTreeLine?: boolean;
  className?: string;
  contentClassName?: string;
  id?: string;
}

/**
 * 접기/펼치기 패널 — CollapsibleCard·MyJewelryRegisterFoldSection과 동일한 height 트윈.
 * `showTreeLine` 시 트리형 세로 연결선 scaleY 애니메이션을 함께 재생한다.
 */
export function CollapsibleExpandPanel({
  isOpen,
  children,
  showTreeLine = false,
  className,
  contentClassName,
  id,
}: CollapsibleExpandPanelProps) {
  return (
    <motion.div
      id={id}
      initial={COLLAPSIBLE_CARD_PRESENCE_INITIAL}
      animate={isOpen ? "open" : "closed"}
      variants={COLLAPSIBLE_HEIGHT_CONTENT_VARIANTS}
      className={cn("overflow-hidden", className)}
      aria-hidden={!isOpen}
    >
      <div className={cn("relative", contentClassName)}>
        {showTreeLine ? (
          <motion.div
            aria-hidden
            className='bg-line-default absolute top-0 left-4 w-px'
            initial={false}
            animate={{
              scaleY: isOpen ? 1 : 0,
              opacity: isOpen ? 1 : 0,
            }}
            transition={{
              scaleY: COLLAPSIBLE_HEIGHT_TRANSITION,
              opacity: { duration: 0.15 },
            }}
            style={{
              height: "100%",
              transformOrigin: "top center",
            }}
          />
        ) : null}
        {children}
      </div>
    </motion.div>
  );
}

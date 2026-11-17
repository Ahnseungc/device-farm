"use client";

import { useContext, useState, type ReactNode } from "react";
import { motion, PresenceContext, useReducedMotionConfig } from "framer-motion";

import { COLLAPSIBLE_HEIGHT_CONTENT_VARIANTS } from "./animations/collapsibleHeightMotion";
import { cn } from "./cn";

interface ListItemPresenceProps {
  children: ReactNode;
  /** `ul` · `ol` 바로 아래면 `li` */
  as?: "li" | "div";
  className?: string;
}

/**
 * 리스트 항목 추가·삭제 — 높이를 펼치며 나타나고, 접히며 사라진다 (`COLLAPSIBLE_HEIGHT_CONTENT_VARIANTS`).
 *
 * 부모 `<AnimatePresence initial={false}>` 안에서 항목마다 고유 `key` 로 쓴다 — 첫 화면에 이미 있는 항목은 그대로 두고,
 * 그 뒤에 들어오고 빠지는 항목만 움직인다.
 * ⭐항목 사이 간격은 부모 `gap` 대신 이 요소 안 padding 으로 둔다. `gap` 은 높이와 함께 줄지 않아 다 접힌 뒤 툭 붙는다.
 * ⭐움직이는 동안만 자른다 — 다 펼쳐진 뒤에도 자르면 행 강조(`RowBlinkHighlight`)처럼 행 밖으로 넓힌 배경이 잘린다.
 *   variants 의 `transitionEnd` · 지연 `overflow` 는 들어오는 항목에서 펼쳐지기 전에 풀려 상태로 둔다.
 * reduced motion 이면 움직이지 않고 바로 넣고 뺀다.
 */
export default function ListItemPresence({ children, as = "div", className }: ListItemPresenceProps) {
  const shouldReduceMotion = useReducedMotionConfig() === true;
  // 첫 화면부터 있던 항목은 `AnimatePresence initial={false}` 가 `initial: false` 로 내려 준다 — 움직이지 않으니 자를 일도 없다
  const presence = useContext(PresenceContext);
  const [isMoving, setIsMoving] = useState(() => !shouldReduceMotion && presence?.initial !== false);
  const MotionElement = as === "li" ? motion.li : motion.div;

  return (
    <MotionElement
      className={cn(isMoving && "overflow-hidden", className)}
      variants={shouldReduceMotion ? undefined : COLLAPSIBLE_HEIGHT_CONTENT_VARIANTS}
      initial={shouldReduceMotion ? false : "closed"}
      animate='open'
      exit={shouldReduceMotion ? undefined : "closed"}
      onAnimationStart={() => setIsMoving(true)}
      onAnimationComplete={(definition) => {
        if (definition === "open") setIsMoving(false);
      }}
    >
      {children}
    </MotionElement>
  );
}

import type { Transition, Variants } from "framer-motion";

/**
 * 접기/펼치기 높이 트윈 (CollapsibleCard · 홈 법적 푸터 등 공통)
 * 토스 스타일 ease
 */
export const COLLAPSIBLE_HEIGHT_TRANSITION: Transition = {
  type: "tween",
  duration: 0.35,
  ease: [0.32, 0.72, 0, 1],
};

/**
 * AnimatePresence + height:auto 조합용 variants (마운트/언마운트 페이드)
 */
export const COLLAPSIBLE_HEIGHT_CONTENT_VARIANTS: Variants = {
  open: {
    height: "auto",
    opacity: 1,
    transition: {
      height: COLLAPSIBLE_HEIGHT_TRANSITION,
      opacity: { duration: 0.3 },
    },
  },
  closed: {
    height: 0,
    opacity: 0,
    transition: {
      height: COLLAPSIBLE_HEIGHT_TRANSITION,
      opacity: { duration: 0.25 },
    },
  },
};

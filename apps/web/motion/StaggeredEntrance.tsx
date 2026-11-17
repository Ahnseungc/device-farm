"use client";

import { createContext, type ReactNode, useContext, useMemo } from "react";
import { motion, useReducedMotionConfig } from "framer-motion";
import {
  PAGE_ENTRANCE_Y_OFFSET_PX,
  pageEntranceTransition,
} from "./animations/pageEntranceMotion";
import {
  ENTRANCE_STYLE_SLIDE_IN_RIGHT_DISTANCE,
  entranceStyleChildTransition,
  entranceStyleListTransition,
  entranceStyleStaggerDelay,
} from "./animations/entranceStyleMotion";
import { cn } from "./cn";
import { useMotionTier } from "./motion-tier";

/** 토스 스타일 스태거 입장 애니메이션용 트랜지션 프리셋 */
export const staggerTransitions = {
  content: {
    type: "spring" as const,
    stiffness: 300,
    damping: 30,
  },
  icon: {
    type: "spring" as const,
    stiffness: 320,
    damping: 24,
    mass: 0.8,
  },
} as const;

interface StaggeredEntranceContextValue {
  reduced: boolean;
  /** 모션 등급 `reduced` — 이동·확대 없이 페이드만 */
  fadeOnly: boolean;
}
const StaggeredEntranceContext = createContext<StaggeredEntranceContextValue>({
  reduced: false,
  fadeOnly: false,
});

interface StaggeredEntranceProps {
  children: ReactNode;
  /** stagger 간격(초). 기본 0.12 */
  staggerChildren?: number;
  /** 첫 자식 전 초(초). 기본 0.05 */
  delayChildren?: number;
  className?: string;
}

/**
 * 자식들을 순차적으로 등장시키는 스태거 애니메이션 루트.
 * 직계 자식은 StaggeredEntrance.Item 이어야 하며, "hidden" → "visible" variants로 연동됨.
 */
export function StaggeredEntrance({
  children,
  staggerChildren = 0.12,
  delayChildren = 0.05,
  className,
}: StaggeredEntranceProps) {
  const shouldReduceMotion = useReducedMotionConfig();
  const fadeOnly = useMotionTier() === "reduced";
  const value = useMemo(
    () => ({ reduced: !!shouldReduceMotion, fadeOnly }),
    [shouldReduceMotion, fadeOnly],
  );

  return (
    <StaggeredEntranceContext.Provider value={value}>
      <motion.div
        className={cn(className)}
        initial='hidden'
        animate='visible'
        variants={{
          visible: {
            transition: {
              staggerChildren: fadeOnly ? 0 : staggerChildren,
              delayChildren,
            },
          },
          hidden: {},
        }}
      >
        {children}
      </motion.div>
    </StaggeredEntranceContext.Provider>
  );
}

type ItemVariant = "fadeUp" | "fadeDown" | "smoothDown" | "scaleIn" | "fade" | "slideInRight";

interface StaggeredEntranceItemProps {
  children: ReactNode;
  /** 애니메이션 타입. smoothDown=위에서 부드럽게 연속 등장(페이지용), fadeDown=위에서 등장+미세 scale */
  variant?: ItemVariant;
  /** fadeUp/fadeDown/smoothDown/scaleIn/slideInRight 시 이동·축소 거리 */
  distance?: number;
  className?: string;
}

interface GetItemVariantsOptions {
  delay?: number;
  fadeOnly?: boolean;
}

function getItemTransition(
  variant: ItemVariant,
  reduced: boolean,
  delay = 0,
) {
  if (reduced) return { duration: 0 };

  if (variant === "slideInRight") {
    return entranceStyleListTransition(delay);
  }

  if (variant === "fadeDown") {
    return entranceStyleChildTransition(delay);
  }

  if (variant === "smoothDown") {
    return pageEntranceTransition(delay);
  }

  // delay: 0을 넣으면 부모 staggerChildren이 무시되어 일괄 등장한다.
  if (delay > 0) {
    return { ...staggerTransitions.content, delay };
  }
  return staggerTransitions.content;
}

function getItemVariants(
  variant: ItemVariant,
  reduced: boolean,
  distance?: number,
  options?: GetItemVariantsOptions,
) {
  if (options?.fadeOnly && !reduced) {
    return {
      hidden: { opacity: 0 },
      visible: {
        opacity: 1,
        transition: getItemTransition(variant, false, options.delay),
      },
    };
  }

  const noMotion = reduced ? 0 : undefined;
  const y =
    variant === "fadeUp"
      ? reduced
        ? 0
        : (distance ?? 8)
      : variant === "fadeDown"
        ? reduced
          ? 0
          : -(distance ?? 6)
        : variant === "smoothDown"
          ? reduced
            ? 0
            : -(distance ?? PAGE_ENTRANCE_Y_OFFSET_PX)
          : noMotion;
  const scale =
    variant === "scaleIn"
      ? reduced
        ? 1
        : (distance ?? 0.92)
      : variant === "fadeDown"
        ? reduced
          ? 1
          : 0.98
        : undefined;
  const x =
    variant === "slideInRight"
      ? reduced
        ? 0
        : (distance ?? ENTRANCE_STYLE_SLIDE_IN_RIGHT_DISTANCE)
      : noMotion;
  const opacityStart = reduced ? 1 : 0;
  const delay = options?.delay ?? 0;

  return {
    hidden: {
      opacity: opacityStart,
      ...(y !== undefined && { y }),
      ...(scale !== undefined && { scale }),
      ...(x !== undefined && { x }),
    },
    visible: {
      opacity: 1,
      ...(y !== undefined && { y: 0 }),
      ...(scale !== undefined && { scale: 1 }),
      ...(x !== undefined && { x: 0 }),
      transition: getItemTransition(variant, reduced, delay),
    },
  };
}

/**
 * StaggeredEntrance 내부에서 사용하는 한 덩어리. variant에 따라 fadeUp / scaleIn / fade 적용.
 */
export function StaggeredEntranceItem({
  children,
  variant = "fadeUp",
  distance,
  className,
}: StaggeredEntranceItemProps) {
  const { reduced, fadeOnly } = useContext(StaggeredEntranceContext);
  const variants = useMemo(
    () => getItemVariants(variant, reduced, distance, { fadeOnly }),
    [variant, reduced, distance, fadeOnly],
  );

  return (
    <motion.div className={cn(className)} variants={variants}>
      {children}
    </motion.div>
  );
}

interface StaggeredEntranceIndexedItemProps {
  children: ReactNode;
  /** 스태거 순서(0부터). 무한 스크롤 등 동적 리스트에서 행별 delay 계산에 사용 */
  index: number;
  variant?: ItemVariant;
  distance?: number;
  /** 첫 행 전 기본 delay(초). 기본 0.05 */
  baseDelay?: number;
  /** delay 계산 시 index 상한. 기본 12 */
  maxStaggerIndex?: number;
  /** false면 마운트 시 등장 애니메이션을 건너뛴다 */
  play?: boolean;
  className?: string;
}

/**
 * 부모 StaggeredEntrance 없이 index 기반 delay로 등장하는 행.
 * 피드·무한 스크롤 리스트처럼 항목이 늘어나는 UI에 사용한다.
 */
export function StaggeredEntranceIndexedItem({
  children,
  index,
  variant = "slideInRight",
  distance,
  baseDelay = 0.05,
  maxStaggerIndex,
  play = true,
  className,
}: StaggeredEntranceIndexedItemProps) {
  const reduced = useReducedMotionConfig();
  const fadeOnly = useMotionTier() === "reduced";
  const delay = reduced || fadeOnly
    ? 0
    : entranceStyleStaggerDelay(index, baseDelay, maxStaggerIndex);
  const variants = useMemo(
    () => getItemVariants(variant, !!reduced, distance, { delay, fadeOnly }),
    [variant, reduced, distance, delay, fadeOnly],
  );

  return (
    <motion.div
      className={cn(className)}
      initial={play ? 'hidden' : false}
      animate='visible'
      variants={variants}
      style={{ willChange: reduced || !play ? undefined : "transform, opacity" }}
    >
      {children}
    </motion.div>
  );
}

StaggeredEntrance.Item = StaggeredEntranceItem;
StaggeredEntrance.IndexedItem = StaggeredEntranceIndexedItem;

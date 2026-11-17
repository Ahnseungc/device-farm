"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useRef } from "react";
import {
  AnimatePresence,
  LazyMotion,
  domAnimation,
  m,
  useReducedMotionConfig,
} from "framer-motion";

import {
  ENTRANCE_STYLE_DURATION,
  ENTRANCE_STYLE_EASE,
  ENTRANCE_STYLE_STAGGER_STEP_S,
} from "./animations/entranceStyleMotion";
import { cn } from "./cn";
import { useMotionTier } from "./motion-tier";

import { calcEntranceCompleteMs, calcFooterEntranceDelay } from "./cardStaggerListTiming";

/** 리스트 행 슬라이드업 기본 스태거(초) */
export const LIST_STAGGER_CHILDREN_S = ENTRANCE_STYLE_STAGGER_STEP_S;
/** 타이틀 등 선행 모션 뒤 리스트 시작 delay(초) */
export const LIST_DELAY_CHILDREN_S = 0.16;
/** 아래에서 올라오는 거리(px) */
export const LIST_SLIDE_UP_Y = 12;
/** 삭제 시 위로 살짝 올라가며 사라지는 거리(px) */
export const LIST_EXIT_Y = -6;

const LIST_LAYOUT_TRANSITION = {
  duration: 0.28,
  ease: ENTRANCE_STYLE_EASE,
} as const;

const LIST_EXIT_TRANSITION = {
  height: { duration: 0.28, ease: ENTRANCE_STYLE_EASE },
  opacity: { duration: 0.2, ease: ENTRANCE_STYLE_EASE },
  y: { duration: 0.22, ease: ENTRANCE_STYLE_EASE },
} as const;

interface CardStaggerListProps<T> {
  items: T[];
  getKey: (item: T, index: number) => string;
  renderItem: (item: T, index: number) => ReactNode;
  className?: string;
  itemClassName?: string;
  /** 스태거 간격(초). 기본 0.06 */
  staggerChildren?: number;
  /** 첫 행 전 delay(초). 기본 0.16 — 타이틀 등장 후 */
  delayChildren?: number;
  /** 아래에서 올라오는 거리(px). 기본 12 */
  slideUpY?: number;
  /** 리스트 끝 추가 행(예: 추가 입력하기) — 동일 스태거로 등장 */
  footer?: ReactNode;
  footerClassName?: string;
  /** footer 입장 스태거. 기본 true — false면 즉시 표시 */
  animateFooter?: boolean;
  enabled?: boolean;
  /**
   * remount 후에도 이미 표시된 키는 입장 스킵.
   * 추가 입력 후 복귀 시 기존 행은 고정하고 신규만 입장시킬 때 사용.
   */
  initialPlayedKeys?: readonly string[];
}

/**
 * 토스 스타일 리스트/카드 행 슬라이드업 스태거.
 * 등장: 신규 키만 아래에서 순차 상승. 이미 본 키·initialPlayedKeys는 즉시 표시.
 * 삭제: height·opacity로 접히며 남은 행·footer가 layout으로 따라 올라온다.
 */
export default function CardStaggerList<T>({
  items,
  getKey,
  renderItem,
  className,
  itemClassName,
  staggerChildren: staggerChildrenProp = LIST_STAGGER_CHILDREN_S,
  delayChildren = LIST_DELAY_CHILDREN_S,
  slideUpY: slideUpYProp = LIST_SLIDE_UP_Y,
  footer,
  footerClassName,
  animateFooter = true,
  enabled = true,
  initialPlayedKeys,
}: CardStaggerListProps<T>) {
  const reducedMotion = useReducedMotionConfig();
  // 모션 등급 reduced: 행 간격 없이 한 번에, 올라오지 않고 페이드만
  const fadeOnly = useMotionTier() === "reduced";
  const staggerChildren = fadeOnly ? 0 : staggerChildrenProp;
  const slideUpY = fadeOnly ? 0 : slideUpYProp;
  const shouldAnimate = enabled && !reducedMotion;
  const hasFooter = footer != null;

  const playedKeysRef = useRef<Set<string> | null>(null);
  if (playedKeysRef.current === null) {
    playedKeysRef.current = new Set(initialPlayedKeys ?? []);
  }

  const footerHasPlayedRef = useRef(
    Boolean(initialPlayedKeys && initialPlayedKeys.length > 0),
  );

  const itemKeys = useMemo(
    () => items.map((item, index) => getKey(item, index)),
    [getKey, items],
  );

  const enteringKeys = useMemo(
    () => itemKeys.filter((key) => !playedKeysRef.current!.has(key)),
    [itemKeys],
  );

  const enteringIndexByKey = useMemo(() => {
    const map = new Map<string, number>();
    enteringKeys.forEach((key, index) => {
      map.set(key, index);
    });
    return map;
  }, [enteringKeys]);

  const playFooterEntrance =
    shouldAnimate && animateFooter && !footerHasPlayedRef.current;

  /** 기존 행이 있는 상태에서 신규만 입장할 때는 타이틀 delay 없이 바로 */
  const isPartialEntrance =
    enteringKeys.length > 0 && enteringKeys.length < itemKeys.length;
  const effectiveDelayChildren = isPartialEntrance ? 0 : delayChildren;

  useEffect(() => {
    if (!shouldAnimate) {
      itemKeys.forEach((key) => playedKeysRef.current!.add(key));
      footerHasPlayedRef.current = true;
      return;
    }

    if (enteringKeys.length === 0 && !playFooterEntrance) {
      return;
    }

    const timer = window.setTimeout(() => {
      enteringKeys.forEach((key) => playedKeysRef.current!.add(key));
      if (playFooterEntrance) {
        footerHasPlayedRef.current = true;
      }
    }, calcEntranceCompleteMs(
      enteringKeys.length,
      effectiveDelayChildren,
      staggerChildren,
      animateFooter,
      hasFooter,
      playFooterEntrance,
    ));

    return () => window.clearTimeout(timer);
  }, [
    animateFooter,
    effectiveDelayChildren,
    enteringKeys,
    hasFooter,
    itemKeys,
    playFooterEntrance,
    shouldAnimate,
    staggerChildren,
  ]);

  if (!shouldAnimate) {
    return (
      <div className={className}>
        {items.map((item, index) => (
          <div key={getKey(item, index)} className={itemClassName}>
            {renderItem(item, index)}
          </div>
        ))}
        {footer ? <div className={footerClassName}>{footer}</div> : null}
      </div>
    );
  }

  const entranceDelayForKey = (key: string) => {
    const enteringIndex = enteringIndexByKey.get(key);
    if (enteringIndex == null) return 0;
    return effectiveDelayChildren + enteringIndex * staggerChildren;
  };

  const footerEntranceDelay = playFooterEntrance
    ? calcFooterEntranceDelay(
        enteringKeys.length,
        effectiveDelayChildren,
        staggerChildren,
      )
    : 0;

  return (
    <LazyMotion features={domAnimation}>
      <div className={cn(className)}>
        {/*
         * remount 시 신규 키도 입장해야 하므로 AnimatePresence initial={false} 금지.
         * 스킵은 행별 initial={false}로만 한다.
         */}
        <AnimatePresence>
          {items.map((item, index) => {
            const key = itemKeys[index] ?? getKey(item, index);
            const isEntering = enteringIndexByKey.has(key);
            const delay = entranceDelayForKey(key);

            return (
              <m.div
                key={key}
                layout="position"
                className={cn("overflow-hidden", itemClassName)}
                initial={
                  isEntering
                    ? { opacity: 0, y: slideUpY, height: "auto" }
                    : false
                }
                animate={{ opacity: 1, y: 0, height: "auto" }}
                exit={{
                  opacity: 0,
                  height: 0,
                  y: LIST_EXIT_Y,
                  transition: LIST_EXIT_TRANSITION,
                }}
                transition={{
                  layout: LIST_LAYOUT_TRANSITION,
                  opacity: {
                    duration: ENTRANCE_STYLE_DURATION.list,
                    ease: ENTRANCE_STYLE_EASE,
                    delay,
                  },
                  y: {
                    duration: ENTRANCE_STYLE_DURATION.list,
                    ease: ENTRANCE_STYLE_EASE,
                    delay,
                  },
                  height: {
                    duration: ENTRANCE_STYLE_DURATION.list,
                    ease: ENTRANCE_STYLE_EASE,
                  },
                }}
                style={{ willChange: "transform, opacity, height" }}
              >
                {renderItem(item, index)}
              </m.div>
            );
          })}
        </AnimatePresence>

        {footer ? (
          animateFooter ? (
            <m.div
              layout="position"
              className={footerClassName}
              initial={
                playFooterEntrance ? { opacity: 0, y: slideUpY } : false
              }
              animate={{ opacity: 1, y: 0 }}
              transition={{
                layout: LIST_LAYOUT_TRANSITION,
                duration: ENTRANCE_STYLE_DURATION.list,
                ease: ENTRANCE_STYLE_EASE,
                delay: footerEntranceDelay,
              }}
              style={{ willChange: "transform, opacity" }}
            >
              {footer}
            </m.div>
          ) : (
            <div className={footerClassName}>{footer}</div>
          )
        ) : null}
      </div>
    </LazyMotion>
  );
}

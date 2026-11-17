'use client';

import { LayoutGroup, MotionConfig, motion } from 'framer-motion';

import { cn } from './cn';

import {
  ENTRANCE_STYLE_DURATION,
  ENTRANCE_STYLE_EASE,
} from './animations/entranceStyleMotion';

export const TabUnderlineGroup = LayoutGroup;

export const TAB_UNDERLINE_LABEL_TRANSITION_CLASS =
  'transition-colors duration-300 ease-out motion-reduce:transition-none';

const TAB_UNDERLINE_TRANSITION = {
  duration: ENTRANCE_STYLE_DURATION.container,
  ease: ENTRANCE_STYLE_EASE,
} as const;

interface TabUnderlineProps {
  layoutId: string;
  selected: boolean;
  /** 밑줄 색 클래스 */
  className?: string;
}

/** 활성 탭 언더라인. 같은 `layoutId`를 쓰는 탭끼리 미끄러지듯 이동한다. */
export function TabUnderline({ layoutId, selected, className }: TabUnderlineProps) {
  return (
    <span className="relative h-1 w-full" aria-hidden>
      {selected ? (
        // 언더라인 이동은 장식이 아니라 "어느 탭으로 옮겼는지" 위치 정보다.
        // 모션 등급 minimal(루트 MotionConfig reducedMotion="always")에서도 끄지 않는다.
        <MotionConfig reducedMotion="never">
          <motion.span
            layoutId={layoutId}
            className={cn('bg-fill-primary-default absolute inset-0', className)}
            transition={TAB_UNDERLINE_TRANSITION}
          />
        </MotionConfig>
      ) : null}
    </span>
  );
}

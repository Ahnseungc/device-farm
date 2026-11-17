"use client";

import { AnimatePresence, motion, useReducedMotionConfig } from "framer-motion";
import { useEffect, useLayoutEffect, useState, type ReactNode, type RefObject } from "react";

import { MOTION_EASE, MOTION_SPRING } from "./animations/motionTokens";

/*
 * 스포트라이트 코치마크 — @toss/tds-react-native 2.0.5 `components/highlight`(HighlightUI·MessageBox·useHighlightUIAnimation) 를 웹으로 옮겼다.
 * Licensed under the Apache License, Version 2.0 — 원문: components/cash-amount-input/AmountKeypad/LICENSE.tds-react-native.txt
 * 변경: SVG clip-path 구멍 대신 대상 위에 둔 상자의 큰 box-shadow 로 딤을 그린다(구멍 0.9 → 1 배, 나갈 땐 크게 퍼짐).
 *       딤 색은 `--color-bg-toast` 토큰. 구멍 탭 통과·화살표 아이콘은 넣지 않았다.
 * ponytail: 포털 없이 `fixed` 로 띄운다. 조상에 transform 이 있으면 위치가 어긋나므로 그때 createPortal 로 올린다.
 */

export interface SpotlightRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 구멍이 처음엔 대상의 0.9 배에서 커진다 */
const HOLE_INITIAL_SCALE = 0.9;
/** 나갈 때 구멍이 퍼지는 배율 */
const HOLE_EXIT_SCALE = 2.5;
/** 대상과 메시지 사이 간격(px) */
const MESSAGE_GAP_PX = 12;
/** 메시지가 위아래로 떠다니는 폭(px) */
const FLOAT_OFFSET_PX = 5;
/** 0.6s → 0.8s → 0.8s (TDS MessageBox) */
const FLOAT_DURATION_S = 2.2;
const FLOAT_TIMES = [0, 0.6 / FLOAT_DURATION_S, 1.4 / FLOAT_DURATION_S, 1] as const;
const DIM_SHADOW = "0 0 0 9999px var(--color-bg-toast)";

interface SpotlightCoachmarkProps {
  open: boolean;
  /** 화면(viewport) 기준 대상 영역. 없으면 `targetRef` 를 잰다 */
  targetRect?: SpotlightRect;
  targetRef?: RefObject<HTMLElement | null>;
  message: ReactNode;
  onClose: () => void;
}

function useTargetRect(
  open: boolean,
  targetRect?: SpotlightRect,
  targetRef?: RefObject<HTMLElement | null>,
) {
  const [measured, setMeasured] = useState<SpotlightRect | null>(null);

  useLayoutEffect(() => {
    if (!open || targetRect || !targetRef?.current) return;
    const { x, y, width, height } = targetRef.current.getBoundingClientRect();
    setMeasured({ x, y, width, height });
  }, [open, targetRect, targetRef]);

  return targetRect ?? measured;
}

/** 대상 주변만 밝게 남기고 나머지를 어둡게 덮은 뒤 안내 문구를 띄운다. 딤을 탭하거나 Esc 로 닫는다 */
export default function SpotlightCoachmark({
  open,
  targetRect,
  targetRef,
  message,
  onClose,
}: SpotlightCoachmarkProps) {
  const shouldReduceMotion = useReducedMotionConfig() === true;
  const rect = useTargetRect(open, targetRect, targetRef);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  // SSR 에서는 window 가 없다 — 그때는 메시지를 아래에 둔다
  const viewportHeight = typeof window === "undefined" ? 0 : window.innerHeight;
  // 대상이 화면 위쪽 절반이면 메시지를 아래에, 아니면 위에 둔다
  const isMessageBelow =
    rect && viewportHeight > 0 ? rect.y + rect.height / 2 < viewportHeight / 2 : true;
  const floatSign = isMessageBelow ? -1 : 1;
  const floatY = [
    0,
    floatSign * FLOAT_OFFSET_PX,
    -floatSign * FLOAT_OFFSET_PX,
    floatSign * FLOAT_OFFSET_PX,
  ];

  return (
    <AnimatePresence>
      {open && rect ? (
        <motion.div
          key='spotlight'
          role='dialog'
          aria-modal='true'
          className='fixed inset-0 z-50'
          onClick={onClose}
          initial={shouldReduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: MOTION_SPRING.basic }}
          transition={MOTION_SPRING.basic}
        >
          <motion.div
            data-testid='spotlight-hole'
            aria-hidden
            className='rounded-160 pointer-events-none absolute'
            style={{
              left: rect.x,
              top: rect.y,
              width: rect.width,
              height: rect.height,
              boxShadow: DIM_SHADOW,
            }}
            initial={shouldReduceMotion ? false : { scale: HOLE_INITIAL_SCALE }}
            animate={{ scale: 1 }}
            exit={
              shouldReduceMotion
                ? undefined
                : { scale: HOLE_EXIT_SCALE, transition: MOTION_SPRING.slow }
            }
            transition={MOTION_SPRING.basic}
          />
          <motion.div
            className='text-b1-bold absolute inset-x-0 px-5 text-center text-white'
            style={
              isMessageBelow
                ? { top: rect.y + rect.height + MESSAGE_GAP_PX }
                : { bottom: viewportHeight - rect.y + MESSAGE_GAP_PX }
            }
            initial={shouldReduceMotion ? false : { opacity: 0, y: 0 }}
            animate={{ opacity: 1, y: shouldReduceMotion ? 0 : floatY }}
            exit={{ opacity: 0, transition: MOTION_SPRING.rapid }}
            transition={{
              opacity: MOTION_SPRING.quick,
              y: { duration: FLOAT_DURATION_S, times: [...FLOAT_TIMES], ease: MOTION_EASE.out },
            }}
          >
            {message}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

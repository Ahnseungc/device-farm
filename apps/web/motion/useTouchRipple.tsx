"use client";

import { motion, useReducedMotionConfig } from "framer-motion";
import { useRef, useState } from "react";

import { ENTRANCE_STYLE_EASE } from "./animations/entranceStyleMotion";
import { cn } from "./cn";

/** 원이 키를 다 덮도록 키의 긴 변보다 크게 퍼진다 */
const RIPPLE_SIZE_RATIO = 2;
/** 퍼지며 사라지는 시간(초) */
const RIPPLE_DURATION_S = 0.45;

interface Ripple {
  id: number;
  x: number;
  y: number;
  size: number;
}

/**
 * 터치 리플 — 닿은 자리에서 원이 퍼지며 옅어진다 (눌림 배경색 대신).
 * 버튼은 `relative` 여야 하고, 반환한 `layer` 를 버튼 안에 넣는다. 모션 줄이기면 그리지 않는다.
 *
 * @example
 * const { spawn, layer } = useTouchRipple("rounded-120");
 * <button className='relative' onPointerDown={(e) => spawn(e.currentTarget, e.clientX, e.clientY)}>{layer}…</button>
 */
export function useTouchRipple(className?: string) {
  const shouldReduceMotion = useReducedMotionConfig();
  const [ripples, setRipples] = useState<Ripple[]>([]);
  const nextIdRef = useRef(0);

  /** 좌표가 없으면(키보드·포인터 없는 click) 키 가운데에서 퍼진다 */
  const spawn = (target: HTMLElement, clientX?: number, clientY?: number) => {
    if (shouldReduceMotion) return;
    const rect = target.getBoundingClientRect();
    const x = clientX === undefined ? rect.width / 2 : clientX - rect.left;
    const y = clientY === undefined ? rect.height / 2 : clientY - rect.top;
    const size = Math.max(rect.width, rect.height) * RIPPLE_SIZE_RATIO;
    nextIdRef.current += 1;
    const id = nextIdRef.current;
    setRipples((prev) => [...prev, { id, x, y, size }]);
  };

  const remove = (id: number) => setRipples((prev) => prev.filter((ripple) => ripple.id !== id));

  const layer = (
    <span
      aria-hidden='true'
      className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}
    >
      {ripples.map((ripple) => (
        <motion.span
          key={ripple.id}
          // 흰 키 위에서 gray100 은 거의 안 보여 gray200 (2026-11-04)
          className='bg-fill-grayscale-gray200 absolute rounded-full'
          style={{
            left: ripple.x - ripple.size / 2,
            top: ripple.y - ripple.size / 2,
            width: ripple.size,
            height: ripple.size,
          }}
          initial={{ scale: 0, opacity: 1 }}
          animate={{ scale: 1, opacity: 0 }}
          transition={{ duration: RIPPLE_DURATION_S, ease: ENTRANCE_STYLE_EASE }}
          onAnimationComplete={() => remove(ripple.id)}
        />
      ))}
    </span>
  );

  return { spawn, layer };
}

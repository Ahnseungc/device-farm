import type { CSSProperties, ReactNode } from "react";

import {
  ENTRANCE_STYLE_DURATION,
  entranceStyleStaggerDelay,
} from "./animations/entranceStyleMotion";
import { cn } from "./cn";

/** 애니메이션 없이 GPU 레이어 승격만 적용 — SSR 하이드레이션 직후 즉시 페인트용 */
export const gpuLayerClassName = "transform-gpu will-change-transform";

/** globals.css — CSS slideInRight 입장 클래스 */
export const gpuLayerSlideInRightClassName = "gpu-layer-slide-in-right";

/** CSS slideInRight 기본 이동 거리 — Framer Motion 기본(24px)보다 짧게 */
export const GPU_LAYER_SLIDE_IN_RIGHT_DISTANCE = 12;

type GpuLayerEntrance = "none" | "slideInRight";

interface GpuLayerProps {
  children: ReactNode;
  className?: string;
  /** CSS 입장 애니메이션. 기본 none */
  entrance?: GpuLayerEntrance;
  /** slideInRight 스태거 순서(0부터) */
  index?: number;
  /** slideInRight 이동 거리(px). 기본 12 */
  distance?: number;
  /** 첫 행 전 기본 delay(초). 기본 0.05 */
  baseDelay?: number;
  /** delay 계산 시 index 상한 */
  maxStaggerIndex?: number;
}

/**
 * Framer Motion 없이 CSS `will-change`·`transform-gpu`로 합성 레이어를 올린다.
 * `entrance="slideInRight"` 시 짧은 오른쪽 슬라이드 인을 CSS animation으로 적용한다.
 */
export function GpuLayer({
  children,
  className,
  entrance = "none",
  index = 0,
  distance = GPU_LAYER_SLIDE_IN_RIGHT_DISTANCE,
  baseDelay = 0.05,
  maxStaggerIndex,
}: GpuLayerProps) {
  const slideInRight = entrance === "slideInRight";
  const delay = slideInRight ? entranceStyleStaggerDelay(index, baseDelay, maxStaggerIndex) : 0;

  const style: CSSProperties | undefined = slideInRight
    ? {
        ["--gpu-layer-delay" as string]: `${delay.toFixed(2)}s`,
        ["--gpu-layer-slide-distance" as string]: `${distance}px`,
        ["--gpu-layer-duration" as string]: `${ENTRANCE_STYLE_DURATION.list}s`,
      }
    : undefined;

  return (
    <div
      className={cn(
        gpuLayerClassName,
        slideInRight && gpuLayerSlideInRightClassName,
        className,
      )}
      style={style}
    >
      {children}
    </div>
  );
}

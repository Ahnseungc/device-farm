"use client";

import { motion, useReducedMotionConfig, type MotionProps } from "framer-motion";
import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";

import { MOTION_EASE } from "./animations/motionTokens";
import { cn } from "./cn";

/*
 * 새로고침 물결 — 토스 앱 홈 당겨서 새로고침(2026-11-05 녹화)을 보고 만들었다.
 * 새로고침이 끝나면 스피너(원) 자리에서 파장 한 번이 화면 끝까지 퍼진다.
 * 새로고침 중 콘텐츠를 흰 막으로 옅게 덮던 것은 뺐다 — 토스 앱처럼 본문 대신 헤더가 흐려진다(`pull-to-refresh/pullHeaderFade`).
 * 파장은 얇은 링이 아닌 두께 있는 물결 2겹이고, 색 없이 투명하다 — 물결 모양대로 아래 콘텐츠만 굴절처럼 번진다.
 * (골드·흰색을 칠한 버전은 탁해 보여 뺐다)
 */

/**
 * 파장이 번져 사라지는 시간(s).
 * 크기는 TDS `out` 으로 고르게 번지다 멎는다 — spring 은 출발이 빨라 빛줄기처럼 쏘아 나갔다.
 * 퍼지는 거리를 줄여(160vmax) 잔잔하게 번진다. 당겨서 새로고침은 이 시간이 다 지나야 인디케이터를 접는다
 */
export const REFRESH_RIPPLE_SPREAD_S = 1.4;
/** 처음 크기 — 스피너 둘레에서 시작하면 스피너와 구분이 안 돼, 처음부터 스피너보다 넓게 번진 물결에서 시작한다 */
const RING_START_SCALE = 0.18;
/** 물결이 가장 셀 때(전체 시간 비율) — 그 뒤 끝까지 일정하게 옅어진다 */
const RIPPLE_PEAK_AT = 0.15;
/** 링 지름 — 화면 어느 점에서 퍼져도 화면 끝까지 닿는다 */
const RING_DIAMETER = "160vmax";
/**
 * 한 번에 같이 번지는 넓은 물결 2겹 — 겹마다 물살(옅은 그늘)이 깊어지다 앞쪽 물마루(빛)에서 사라진다.
 * 얇은 링이 아니라 두께가 있는 물결. 지름 대비 위치(%)와 진하기(%), 안쪽 겹이 가장 진하고 바깥으로 갈수록 연하다
 */
const WAVE_SWELLS = [
  { from: 10, to: 40, shade: 24 },
  { from: 42, to: 72, shade: 12 },
] as const;
/** 물결 한 겹 안에서 [물살이 짙어지기 시작, 가장 깊은 그늘, 물마루 빛] 자리(겹 폭 대비 비율) */
const SWELL_SHAPE = { body: 0.3, trough: 0.62, crest: 0.8 } as const;
/** 물살이 짙어지기 시작할 때는 가장 깊은 그늘의 이만큼 */
const SWELL_BODY_RATIO = 0.35;
/**
 * 그늘 물결 — 물결 몸통 자리를 옅은 회색으로 덮는다. 흰 바탕에서도 보이고 뒤 요소는 건드리지 않는다.
 * backdrop-filter(blur·밝기·채도)는 뒤 글자·카드를 다시 그려 번져 보여 뺐고(2026-11-05),
 * 흰빛(0.1)은 흰 바탕에서 안 보여 그늘로 바꿨다
 */
/** 다크에선 그늘이 안 보여 흰빛 — 값은 `--color-bg-ripple`(styles/color.css) */
const RING_SHADE = "var(--color-bg-ripple)";
/** 물결 세기(마스크 불투명도, 0~1) — 그늘 자리가 가장 세게 번지고 물마루 앞에서 사라진다 */
const SWELL_STRENGTH_RATIO = 1 / 16;
/**
 * 물결 둘레를 일렁이게 — 정원은 너무 단정해 보여, 노이즈(feTurbulence)로 물결 띠를 안팎으로 밀어낸다.
 * 주파수는 지름(마스크 100) 당 굴곡 수, 밀어내는 폭은 지름 대비(%). 퍼질 때마다 seed 를 바꿔 모양이 매번 다르다
 */
const RING_WOBBLE = { frequency: 0.035, octaves: 2, displacement: 7 } as const;
/** CSS radial-gradient(circle) 기본 반지름(정사각형 대각선 절반)을 마스크 좌표(한 변 100)로 */
const RING_GRADIENT_RADIUS = 50 * Math.SQRT2;

function maskOpacity(percent: number) {
  return Math.min(percent * SWELL_STRENGTH_RATIO, 1);
}

/** 물결 한 겹의 굴절 세기 — 물살에서 점점 세지다 물마루 앞에서 사라진다 */
function swellMaskStops({ from, to, shade }: (typeof WAVE_SWELLS)[number]) {
  const at = (ratio: number) => from + (to - from) * ratio;
  const stop = (offset: number, opacity: number) =>
    `<stop offset="${offset}%" stop-opacity="${opacity}"/>`;
  return [
    stop(from, 0),
    stop(at(SWELL_SHAPE.body), maskOpacity(shade * SWELL_BODY_RATIO)),
    stop(at(SWELL_SHAPE.trough), maskOpacity(shade)),
    stop(at(SWELL_SHAPE.crest), maskOpacity(shade * SWELL_BODY_RATIO)),
    stop(to, 0),
  ].join("");
}

const RING_STOPS = WAVE_SWELLS.map(swellMaskStops).join("");

/** 일렁이는 물결 마스크(SVG) — seed 마다 둘레 굴곡이 다르다 */
function buildRingMask(seed: number) {
  const { frequency, octaves, displacement } = RING_WOBBLE;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="none"><defs><radialGradient id="g" gradientUnits="userSpaceOnUse" cx="50" cy="50" r="${RING_GRADIENT_RADIUS}">${RING_STOPS}</radialGradient><filter id="w" x="0" y="0" width="100" height="100" filterUnits="userSpaceOnUse"><feTurbulence type="fractalNoise" baseFrequency="${frequency}" numOctaves="${octaves}" seed="${seed}"/><feDisplacementMap in="SourceGraphic" scale="${displacement}" xChannelSelector="R" yChannelSelector="G"/></filter></defs><rect width="100" height="100" fill="url(#g)" filter="url(#w)"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/** 물결이 번지는 크기·시간 (framer 키프레임은 readonly 배열을 못 받아 as const 대신 satisfies) */
const RING_MOTION = {
  initial: { scale: RING_START_SCALE, opacity: 0 },
  animate: { scale: 1, opacity: [0, 1, 0] },
  transition: {
    scale: { duration: REFRESH_RIPPLE_SPREAD_S, ease: MOTION_EASE.out },
    opacity: {
      duration: REFRESH_RIPPLE_SPREAD_S,
      ease: MOTION_EASE.linear,
      times: [0, RIPPLE_PEAK_AT, 1],
    },
  },
} satisfies MotionProps;

type RippleCoordinate = number | string;

interface RippleOrigin {
  x: RippleCoordinate;
  y: RippleCoordinate;
}

/** 기준점을 정하지 않으면 위 가운데 */
const DEFAULT_ORIGIN: RippleOrigin = { x: "50%", y: 0 };

interface RefreshRippleProps {
  /** 새로고침 중. true → false 로 바뀌는 순간 물결이 퍼진다 */
  active: boolean;
  /** 이 요소 가운데에서 퍼진다 (새로고침 버튼 등). 없으면 `origin` */
  originRef?: RefObject<HTMLElement | null>;
  /** 이 막 안의 좌표(px 또는 %) */
  origin?: RippleOrigin;
  className?: string;
}

interface RipplePlay {
  key: number;
  origin: RippleOrigin;
  mask: string;
}

function ringPosition(origin: RippleOrigin) {
  return {
    left: origin.x,
    top: origin.y,
    width: RING_DIAMETER,
    height: RING_DIAMETER,
    x: "-50%",
    y: "-50%",
  } as const;
}

/** 막 안의 좌표(px·%)를 화면 물결 레이어 기준 px 로 — 레이어는 헤더까지 덮는다 */
function resolveCoordinate(value: RippleCoordinate, start: number, size: number) {
  if (typeof value === "number") return start + value;
  return start + (size * parseFloat(value)) / 100;
}

function measureOrigin({
  overlay,
  layer,
  target,
  origin,
}: {
  overlay: HTMLElement;
  layer: HTMLElement;
  target: HTMLElement | null | undefined;
  origin: RippleOrigin;
}): RippleOrigin {
  const layerRect = layer.getBoundingClientRect();
  if (target) {
    const targetRect = target.getBoundingClientRect();
    return {
      x: targetRect.left + targetRect.width / 2 - layerRect.left,
      y: targetRect.top + targetRect.height / 2 - layerRect.top,
    };
  }
  const overlayRect = overlay.getBoundingClientRect();
  return {
    x: resolveCoordinate(origin.x, overlayRect.left, overlayRect.width) - layerRect.left,
    y: resolveCoordinate(origin.y, overlayRect.top, overlayRect.height) - layerRect.top,
  };
}

/**
 * 새로고침이 끝나면 기준점(스피너·버튼)에서 파장 한 번이 퍼진다.
 * 기준 좌표(`origin`)는 가장 가까운 `position` 조상(`absolute inset-0`) 안에서 잰다 — 그 영역에 `relative` 를 둔다.
 * 물결은 화면 전체 레이어(body 포털, 본문 폭 420px)에 그려 웹 헤더 위까지 퍼진다.
 * ⛔앱 네이티브 상단바는 WebView 밖이라 그 위로는 못 그린다 — WebView 맨 위에서 잘린다.
 * 클릭은 통과한다. 모션 줄이기면 물결이 없다.
 */
export default function RefreshRipple({
  active,
  originRef,
  origin = DEFAULT_ORIGIN,
  className,
}: RefreshRippleProps) {
  const shouldReduceMotion = useReducedMotionConfig();
  const overlayRef = useRef<HTMLSpanElement>(null);
  const layerRef = useRef<HTMLSpanElement>(null);
  // 포털은 브라우저에서만 — 서버 렌더에는 document 가 없다
  const [canPortal, setCanPortal] = useState(false);
  useEffect(() => setCanPortal(true), []);
  const wasActiveRef = useRef(active);
  const [play, setPlay] = useState<RipplePlay | null>(null);

  useEffect(() => {
    const finished = wasActiveRef.current && !active;
    wasActiveRef.current = active;
    if (!finished || shouldReduceMotion) return;
    const overlay = overlayRef.current;
    const layer = layerRef.current;
    if (!overlay || !layer) return;
    const measured = measureOrigin({ overlay, layer, target: originRef?.current, origin });
    setPlay((previous) => {
      const key = (previous?.key ?? 0) + 1;
      return { key, origin: measured, mask: buildRingMask(key) };
    });
  }, [active, origin, originRef, shouldReduceMotion]);

  return (
    <span
      ref={overlayRef}
      aria-hidden
      className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}
    >
      {canPortal
        ? createPortal(
            // 헤더(sticky z-100)보다 위, 바텀시트·팝업(--z-overlay 10001~)보다 아래 — 클릭은 통과한다
            <span
              ref={layerRef}
              aria-hidden
              className='device-max-width pointer-events-none fixed inset-y-0 right-0 left-0 z-[101] mx-auto overflow-hidden'
            >
              {play ? (
                <motion.span
                  key={play.key}
                  data-refresh-ripple-ring=''
                  className='absolute'
                  style={{
                    ...ringPosition(play.origin),
                    maskImage: play.mask,
                    WebkitMaskImage: play.mask,
                    maskSize: "100% 100%",
                    WebkitMaskSize: "100% 100%",
                    backgroundColor: RING_SHADE,
                  }}
                  {...RING_MOTION}
                />
              ) : null}
            </span>,
            document.body,
          )
        : null}
    </span>
  );
}

import type { Transition } from "framer-motion";

import { MOTION_SPRING } from "./motionTokens";

/*
 * 공유 요소 이동 — 앞 화면의 요소가 제자리에서 다음 화면의 자기 자리로 옮겨 가 합쳐진다 (framer `layoutId`).
 * 토스트처럼 일정하게 감속하며 들어오도록 TDS spring `small`(480/50 — 상단 토스트와 같다)을 쓴다.
 * 감쇠가 임계보다 커 넘치지 않는다. TDS `ease` tween([.6,0,0,.6])은 가운데만 빨라 중간에 끊겨 보였다 (2026-11-04).
 */

/** 공유 요소 이동 spring — 상단 토스트와 같은 TDS `small` */
const SHARED_ELEMENT_SPRING = MOTION_SPRING.small;

/**
 * 눈으로 보기에 다 도착하는 시간(초) — 도착 뒤에 이어 붙일 동작(숫자 바꾸기·카드 등장)의 기준.
 * spring 480/50 은 0.45초쯤 목표의 99% 에 닿는다 (나머지는 눈에 안 보이는 꼬리)
 */
export const SHARED_ELEMENT_LAND_S = 0.45;

/** 공유 요소 layout 전환 */
export const SHARED_ELEMENT_TRANSITION = {
  layout: SHARED_ELEMENT_SPRING,
} as const satisfies Transition;

interface SharedElementOptions {
  /**
   * 요소가 놓인 화면 이름 (예: 퍼널 스텝) — framer `layoutDependency` 로 쓴다.
   * 화면 안에서는 고정이라 금액 입력처럼 글자 폭이 자주 바뀌어도 그때마다 늘었다 줄지 않고,
   * 화면마다 달라서 다른 화면의 같은 `layoutId` 로 넘어갈 때만 옮겨 간다 (둘이 같으면 framer 가 이동을 건너뛴다).
   * 화면 전환 순간의 측정은 바깥 `layout` 래퍼가 `LayoutGroup` 전체에 걸어 준다
   */
  scene: string;
  /**
   * 크기는 그대로 두고 위치만 옮긴다 — 글자처럼 가로세로 비율이 바뀌면 찌그러지는 요소.
   * 글자 크기가 다르면 안쪽에 `sharedTextScaleMotion` 을 둔다
   */
  positionOnly?: boolean;
}

/**
 * framer `motion.*` 에 펼치는 공유 요소 props. `layoutId` 가 없으면(모션 줄이기 등) 아무것도 붙이지 않아 바로 바뀐다.
 *
 * @example
 * <motion.div {...sharedElementMotion(isShared ? "bank-icon" : undefined, { scene: "amount" })}>…</motion.div>
 */
export function sharedElementMotion(
  layoutId: string | undefined,
  { scene, positionOnly = false }: SharedElementOptions,
) {
  if (!layoutId) return {};
  return {
    layoutId,
    layout: positionOnly ? ("position" as const) : true,
    layoutDependency: scene,
    transition: SHARED_ELEMENT_TRANSITION,
  };
}

/**
 * 글자 크기가 다른 두 화면 사이에서 위치만 옮기는 요소의 안쪽 — 앞 화면 글자 크기에서 제 크기로
 * 가로세로 같은 배율로 줄거나 커져 글자가 찌그러지지 않는다. 이동과 같은 spring 이라 위치와 크기가 같이 맞춰진다.
 * framer `layout="position"` 은 앞 자리의 왼쪽 위 모서리에서 출발하므로 배율 기준점도 왼쪽 위로 둔다.
 * @param fromFontPx 앞 화면 글자 크기(px)
 * @param toFontPx 이 화면 글자 크기(px)
 */
export function sharedTextScaleMotion(fromFontPx: number, toFontPx: number) {
  return {
    initial: { scale: fromFontPx / toFontPx },
    animate: { scale: 1 },
    transition: SHARED_ELEMENT_SPRING,
    style: { originX: 0, originY: 0 },
  };
}

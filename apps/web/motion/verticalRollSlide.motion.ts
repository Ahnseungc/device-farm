/** 세로 롤링 슬라이드 — 헤더 타이틀 전환·시세 ticker 등 공통 */
export const VERTICAL_ROLL_SLIDE_TRANSITION = {
  duration: 0.45,
  ease: [0.33, 1, 0.68, 1] as const,
};

/** 헤더 — 로고 자리에 값, 아래→위 슬라이드 (롤링 아님) */
export const HEADER_TICKER_SLIDE_UP_TRANSITION = {
  duration: 0.28,
  ease: [0.33, 1, 0.68, 1] as const,
};

/** @deprecated HEADER_TICKER_SLIDE_UP_TRANSITION 사용 */
export const HEADER_TICKER_TRANSITION = HEADER_TICKER_SLIDE_UP_TRANSITION;

/** 본문 블록이 헤더 방향으로 올라가는 느낌 (transform only, 레이아웃 불변) */
export const COLLAPSE_INTO_HEADER_SPRING = {
  type: "spring" as const,
  stiffness: 520,
  damping: 28,
  mass: 0.72,
};

/** 본문 시세 다시 보일 때 */
export const COLLAPSE_INTO_HEADER_EXPAND_TRANSITION = {
  duration: 0.45,
  ease: [0.33, 1, 0.68, 1] as const,
};

/** 헤더 로고 복귀 — 본문 CollapseIntoHeader expand와 동일 */
export const HEADER_LOGO_EXPAND_TRANSITION =
  COLLAPSE_INTO_HEADER_EXPAND_TRANSITION;

export const DEFAULT_COLLAPSE_INTO_HEADER_OFFSET_PX = 48;

export const DEFAULT_COLLAPSE_INTO_HEADER_SCALE_END = 0.82;

/** 헤더로 사라질 때 — y·scale·opacity 모두 tween (opacity는 가장 느리게) */
export const COLLAPSE_INTO_HEADER_COLLAPSE_TRANSITION = {
  y: { duration: 0.75, ease: [0.33, 1, 0.68, 1] as const },
  scale: { duration: 0.75, ease: [0.33, 1, 0.68, 1] as const },
  opacity: { duration: 0.9, ease: [0.4, 0, 0.2, 1] as const },
};

/** 본문 collapse ↔ 헤더 시세 fade-up — y·scale·opacity 타이밍을 collapse와 동기 */
export const COLLAPSE_INTO_HEADER_FADE_UP_PAIR_TRANSITION = {
  y: COLLAPSE_INTO_HEADER_COLLAPSE_TRANSITION.y,
  scale: COLLAPSE_INTO_HEADER_COLLAPSE_TRANSITION.scale,
  opacity: COLLAPSE_INTO_HEADER_COLLAPSE_TRANSITION.opacity,
};

/**
 * 헤더 값 fade-up — collapse와 같은 ease, 등장·퇴장은 더 짧게.
 * (본문 사라짐은 COLLAPSE_INTO_HEADER_COLLAPSE_TRANSITION 유지)
 */
export const HEADER_TICKER_FADE_UP_OFFSET_PX = 28;

/** 헤더 h-6 안 시세 항목 롤링 슬라이드 이동(px) */
export const HEADER_TICKER_SLIDE_ROLL_OFFSET_PX = 12;

export const HEADER_TICKER_FADE_UP_TRANSITION = {
  y: { duration: 0.42, ease: [0.33, 1, 0.68, 1] as const },
  scale: { duration: 0.42, ease: [0.33, 1, 0.68, 1] as const },
  opacity: { duration: 0.5, ease: [0.4, 0, 0.2, 1] as const },
};

type TransitionPart = { duration: number };

function getTransitionMaxDurationMs(
  transition: Record<string, TransitionPart>,
): number {
  const durations = Object.values(transition).map((part) => part.duration);
  return Math.round(Math.max(0, ...durations) * 1000);
}

/** 본문 collapse y duration — 위로 올라가는 구간만 롤링 정지 */
export const HEADER_TICKER_COLLAPSE_ROLLING_PAUSE_MS = getTransitionMaxDurationMs({
  y: COLLAPSE_INTO_HEADER_COLLAPSE_TRANSITION.y,
});

/** @deprecated `DEFAULT_COLLAPSE_INTO_HEADER_OFFSET_PX` — collapse·헤더 fade-up 페어 */
export const VERTICAL_ROLL_FADE_UP_ENTER_OFFSET_PX = DEFAULT_COLLAPSE_INTO_HEADER_OFFSET_PX;

/** @deprecated expand/collapse 분리 전 기본값 — expand와 동일 */
export const COLLAPSE_INTO_HEADER_TRANSITION = COLLAPSE_INTO_HEADER_EXPAND_TRANSITION;

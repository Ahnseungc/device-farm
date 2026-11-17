import { runAfterPaintWhen } from "./runAfterPaint";

/**
 * 카드 등장 — 뒷면을 보인 채 아래에서 올라오며 커지고(RISE), 자리를 잡으면 Y축 반 바퀴 뒤집혀 앞면을 보여준다(FLIP).
 */
export const CARD_SPIN_ENTRANCE_RISE_S = 0.55;
/** 뒤집기 시간 */
export const CARD_SPIN_ENTRANCE_DURATION_S = 0.8;
/** 올라오기 시작부터 뒤집기가 끝날 때까지 */
export const CARD_SPIN_ENTRANCE_TOTAL_S = CARD_SPIN_ENTRANCE_RISE_S + CARD_SPIN_ENTRANCE_DURATION_S;
/** 회전 초반 opacity 만 먼저 올라오는 시간 */
export const CARD_SPIN_ENTRANCE_FADE_S = 0.3;
/** 3D 원근 — 작을수록 회전이 과장된다. 1200 은 납작해서 면 전환이 끊겨 보였다 */
export const CARD_SPIN_ENTRANCE_PERSPECTIVE_PX = 900;
/** 시작 위치 — 화면 아래쪽에서 올라온다 */
export const CARD_SPIN_ENTRANCE_RISE_PX = 160;

/** 회전은 면 음영을 같이 계산하려고 motion value 로 따로 돌린다. -180° = 뒷면이 보이는 상태에서 출발 */
export const CARD_SPIN_ENTRANCE_START_ROTATE_Y = -180;

export const CARD_SPIN_ENTRANCE_INITIAL = {
  y: CARD_SPIN_ENTRANCE_RISE_PX,
  scale: 0.6,
  opacity: 0,
} as const;
export const CARD_SPIN_ENTRANCE_ANIMATE = { y: 0, scale: 1, opacity: 1 } as const;

/**
 * 회전 곡선 — 천천히 출발해 가운데서 돌고 끝에서 감속한다.
 * easeOut 이면 360° 대부분이 초반에 지나가 뒷면이 몇 프레임만 보이고 툭 바뀌었다.
 */
export const CARD_SPIN_ENTRANCE_EASE = [0.45, 0.05, 0.25, 1] as const;

/** 착지 — 크기·위치는 스프링으로 아주 살짝 넘쳤다가 제자리에 앉는다 (장식 대신 물리감) */
export const CARD_SPIN_ENTRANCE_SETTLE_SPRING = {
  type: "spring",
  stiffness: 140,
  damping: 17,
  mass: 1,
} as const;

/** 뒤집기는 올라오기가 끝난 뒤 */
export function cardSpinEntranceRotateTransition(delay = 0) {
  return {
    duration: CARD_SPIN_ENTRANCE_DURATION_S,
    ease: CARD_SPIN_ENTRANCE_EASE,
    delay: delay + CARD_SPIN_ENTRANCE_RISE_S,
  };
}

export function cardSpinEntranceTransition(delay = 0) {
  return {
    y: { ...CARD_SPIN_ENTRANCE_SETTLE_SPRING, delay },
    scale: { ...CARD_SPIN_ENTRANCE_SETTLE_SPRING, delay },
    opacity: { duration: CARD_SPIN_ENTRANCE_FADE_S, delay },
  };
}

/** 스포트라이트 딤 — 화면이 어두워졌다가 카드가 자리 잡은 뒤 걷힌다 */
export const CARD_SPOTLIGHT_DIM_OPACITY = 0.72;
export const CARD_SPOTLIGHT_DIM = {
  opacity: [0, CARD_SPOTLIGHT_DIM_OPACITY, CARD_SPOTLIGHT_DIM_OPACITY, 0],
  times: [0, 0.12, 0.72, 1],
  durationS: 2.1,
} as const;

/**
 * 자연광 반짝임 — 카드가 다 올라와 착지한 뒤, 하이라이트가 천천히 한 번 표면을 지나간다.
 * 띠 이미지는 카드 폭의 3배라 background-position-x 100%(왼쪽 밖) → 0%(오른쪽 밖).
 */
export const CARD_GLINT_BACKGROUND_SIZE = "300% 100%";
export const CARD_GLINT_POSITION = { offLeft: 100, offRight: 0 } as const;
export const CARD_GLINT = {
  /** 올라오기·뒤집기가 끝난 직후 */
  startAfterS: CARD_SPIN_ENTRANCE_TOTAL_S + 0.1,
  durationS: 1.6,
  /** 들어올 때 부드럽게, 빠져나갈 때 천천히 */
  ease: [0.4, 0, 0.2, 1],
} as const;

/** 면이 옆으로 돌아갈수록(정면에서 멀수록) 어두워진다 — 최대 불투명도 */
export const CARD_FACE_SHADE_MAX_OPACITY = 0.45;

/** 회전값(°)과 면 오프셋(앞 0 · 뒤 180)으로 그 면의 음영 불투명도 — 정면 0, 옆면일수록 최대 */
export function faceShadeOpacity(rotateYDeg: number, faceOffsetDeg: number): number {
  const radians = ((rotateYDeg + faceOffsetDeg) * Math.PI) / 180;
  return Math.abs(Math.sin(radians)) * CARD_FACE_SHADE_MAX_OPACITY;
}

/** 이중 rAF 간격이 이보다 짧으면 한가하다고 본다 — 저전력 30fps(66ms)는 통과, 긴 작업(50ms+)은 걸린다 */
const SMOOTH_TWO_FRAMES_MS = 80;
/** 연속으로 한가해야 하는 횟수 */
const SMOOTH_STREAK = 2;
/** 계속 바쁘면 이만큼 확인한 뒤 그냥 시작한다 */
const SMOOTH_MAX_ATTEMPTS = 30;

/**
 * 하이드레이션 직후엔 메인 스레드가 막혀 JS 애니메이션이 시간만 흘러 끝 상태로 점프한다.
 * 프레임이 연속으로 제때 그려질 때 callback. cleanup 반환
 */
export function runWhenFramesSmooth(callback: () => void): () => void {
  let lastCheckedAt = performance.now();
  let smoothStreak = 0;
  const isSmooth = () => {
    const now = performance.now();
    smoothStreak = now - lastCheckedAt < SMOOTH_TWO_FRAMES_MS ? smoothStreak + 1 : 0;
    lastCheckedAt = now;
    return smoothStreak >= SMOOTH_STREAK;
  };
  return runAfterPaintWhen(isSmooth, callback, {
    maxAttempts: SMOOTH_MAX_ATTEMPTS,
    onGiveUp: callback,
  });
}

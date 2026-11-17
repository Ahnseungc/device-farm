import { easeSmoothCountProgress, interpolateSmoothCountValue, resolveSmoothCountUpDurationMs } from "./smoothCountUp";

/** from → to 숫자 전환 (rAF). cleanup 함수 반환 */
export function runNumericTransition(
  from: number,
  to: number,
  durationMs: number | "auto" = "auto",
  onUpdate: (value: number) => void,
  onComplete?: () => void,
): () => void {
  if (from === to) {
    onUpdate(to);
    onComplete?.();
    return () => {};
  }

  const resolvedDurationMs =
    durationMs === "auto" ? resolveSmoothCountUpDurationMs(from, to) : durationMs;

  let rafId = 0;
  let startTime: number | null = null;

  const tick = (now: number) => {
    if (startTime == null) startTime = now;
    const linearT = Math.min((now - startTime) / resolvedDurationMs, 1);
    const easedT = easeSmoothCountProgress(linearT);
    const value = interpolateSmoothCountValue(from, to, easedT);
    onUpdate(value);
    if (linearT < 1) {
      rafId = requestAnimationFrame(tick);
    } else {
      onUpdate(to);
      onComplete?.();
    }
  };

  rafId = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(rafId);
}

/** 0→1 progress (rAF). cleanup 함수 반환 */
export function runRafProgress(
  durationMs: number,
  onUpdate: (progress: number) => void,
  onComplete?: () => void,
): () => void {
  let rafId = 0;
  let startTime: number | null = null;

  const tick = (now: number) => {
    if (startTime == null) startTime = now;
    const t = Math.min((now - startTime) / durationMs, 1);
    onUpdate(t);
    if (t < 1) {
      rafId = requestAnimationFrame(tick);
    } else {
      onComplete?.();
    }
  };

  rafId = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(rafId);
}

/** 경과 시간(ms) 추적 rAF. cleanup 함수 반환 */
export function runRafElapsed(
  maxDurationMs: number,
  onUpdate: (elapsedMs: number) => void,
  onComplete?: () => void,
): () => void {
  let rafId = 0;
  let startTime: number | null = null;

  const tick = (now: number) => {
    if (startTime == null) startTime = now;
    const elapsed = now - startTime;

    if (elapsed >= maxDurationMs) {
      onUpdate(maxDurationMs);
      onComplete?.();
      return;
    }

    onUpdate(elapsed);
    rafId = requestAnimationFrame(tick);
  };

  rafId = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(rafId);
}

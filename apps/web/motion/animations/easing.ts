export function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

/** 토스형 숫자 카운트업 — 끝으로 갈수록 급감속 */
export function easeOutExpo(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return 1 - 2 ** (-10 * t);
}

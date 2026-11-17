/** 세그먼트 순차 채움 — globalProgress(0~1) 기준 구간별 fill (0~1) */
export function getSegmentFillProgress(
  globalProgress: number,
  startOffset: number,
  segmentRate: number,
): number {
  if (segmentRate <= 0 || globalProgress <= startOffset) return 0;
  if (globalProgress >= startOffset + segmentRate) return 1;
  return (globalProgress - startOffset) / segmentRate;
}

const DEFAULT_BAR_WIDTH_PX = 320;
const DEFAULT_MIN_SEG_PX = 4;

/** 작은 세그먼트 최소 너비 보정 (가로 composition bar) */
export function computeCompositionBarDisplayRates(
  rates: number[],
  options?: { totalLengthPx?: number; minSegPx?: number },
): number[] {
  if (rates.length === 0) return [];

  const totalLengthPx = options?.totalLengthPx ?? DEFAULT_BAR_WIDTH_PX;
  const minSegPx = options?.minSegPx ?? DEFAULT_MIN_SEG_PX;
  const minVisibleRate = minSegPx / totalLengthPx;

  const boostNeeded = rates
    .filter((rate) => rate > 0 && rate < minVisibleRate)
    .reduce((sum, rate) => sum + (minVisibleRate - rate), 0);

  if (boostNeeded === 0) return rates;

  const positiveRates = rates.filter((rate) => rate > 0);
  const largestRate = Math.max(...positiveRates);
  const largestIdx = rates.findIndex((rate) => rate === largestRate);

  return rates.map((rate, idx) => {
    if (rate <= 0) return rate;
    if (rate < minVisibleRate) return minVisibleRate;
    if (idx === largestIdx) return Math.max(0, rate - boostNeeded);
    return rate;
  });
}

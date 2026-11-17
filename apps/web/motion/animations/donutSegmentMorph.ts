import { easeOutCubic } from "./easing";

export interface DonutRateSegment {
  color: string;
  rate: number;
  label?: string;
  value?: number;
}

const DONUT_CIRCUMFERENCE = 2 * Math.PI * 61;
const MIN_SEG_PX = 6;

/** 작은 세그먼트 최소 호 길이 보정 */
export function computeDonutDisplayRates(rawSegs: DonutRateSegment[]): number[] {
  if (rawSegs.length === 0) return [];

  const minVisibleRate = MIN_SEG_PX / DONUT_CIRCUMFERENCE;
  const rates = rawSegs.map((seg) => seg.rate);
  const boostNeeded = rates
    .filter((rate) => rate < minVisibleRate)
    .reduce((sum, rate) => sum + (minVisibleRate - rate), 0);

  if (boostNeeded === 0) return rates;

  const largestIdx = rates.reduce(
    (maxIdx, rate, idx) => (rate > rates[maxIdx] ? idx : maxIdx),
    0,
  );

  return rates.map((rate, idx) => {
    if (rate < minVisibleRate) return minVisibleRate;
    if (idx === largestIdx) return Math.max(0, rate - boostNeeded);
    return rate;
  });
}

export function lerpDonutSegments(
  fromSegments: DonutRateSegment[],
  toSegments: DonutRateSegment[],
  progress: number,
): DonutRateSegment[] {
  const eased = easeOutCubic(progress);
  const colors = new Set([
    ...fromSegments.map((seg) => seg.color),
    ...toSegments.map((seg) => seg.color),
  ]);

  return Array.from(colors)
    .map((color) => {
      const fromSeg = fromSegments.find((seg) => seg.color === color);
      const toSeg = toSegments.find((seg) => seg.color === color);
      const fromRate = fromSeg?.rate ?? 0;
      const toRate = toSeg?.rate ?? 0;
      const rate = fromRate + (toRate - fromRate) * eased;

      return {
        color,
        rate,
        label: toSeg?.label ?? fromSeg?.label,
        value: toSeg?.value ?? fromSeg?.value,
      };
    })
    .filter((seg) => seg.rate > 1e-6);
}

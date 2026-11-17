import { useEffect, useState } from "react";

/**
 * 모션 단계. 디바이스팜은 기기 성능 측정이 없어 OS 「동작 줄이기」만 본다.
 * full: 그대로 · minimal: 움직임 없이 바로 보인다.
 */
export const MOTION_TIERS = ["full", "reduced", "minimal"] as const;
export type MotionTier = (typeof MOTION_TIERS)[number];

const reduceQuery = "(prefers-reduced-motion: reduce)";

const readTier = (): MotionTier => (typeof window !== "undefined" && window.matchMedia?.(reduceQuery).matches ? "minimal" : "full");

export function useMotionTier(): MotionTier {
  const [tier, setTier] = useState<MotionTier>(readTier);
  useEffect(() => {
    const media = window.matchMedia?.(reduceQuery);
    if (!media) return;
    const update = () => setTier(readTier());
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return tier;
}

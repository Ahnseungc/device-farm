"use client";

import { useEffect, useState } from "react";
import { useReducedMotionConfig } from "framer-motion";

import {
  PAGE_SLIDE_ANIMATE,
  PAGE_SLIDE_INITIAL,
  PAGE_SLIDE_WILL_CHANGE,
} from "./pageEntranceMotion";
import { runAfterPaint } from "./runAfterPaint";

export type PageSlideEntrancePhase = "pending" | "running" | "complete";

export interface PageSlideEntranceMotionState {
  phase: PageSlideEntrancePhase;
  animate: typeof PAGE_SLIDE_ANIMATE | typeof PAGE_SLIDE_INITIAL;
  willChange: string | undefined;
  handleAnimationComplete: () => void;
}

/**
 * paint 이후 애니메이션을 시작하고, 종료 시 will-change를 해제한다.
 */
export function usePageSlideEntranceMotion(): PageSlideEntranceMotionState {
  const shouldReduceMotion = useReducedMotionConfig();
  const [phase, setPhase] = useState<PageSlideEntrancePhase>(
    shouldReduceMotion ? "complete" : "pending",
  );

  useEffect(() => {
    if (shouldReduceMotion) {
      setPhase("complete");
      return;
    }

    return runAfterPaint(() => {
      setPhase("running");
    });
  }, [shouldReduceMotion]);

  const animate =
    phase === "pending" ? PAGE_SLIDE_INITIAL : PAGE_SLIDE_ANIMATE;

  const willChange =
    phase === "running" ? PAGE_SLIDE_WILL_CHANGE : undefined;

  const handleAnimationComplete = () => {
    setPhase((current) => (current === "running" ? "complete" : current));
  };

  return {
    phase,
    animate,
    willChange,
    handleAnimationComplete,
  };
}

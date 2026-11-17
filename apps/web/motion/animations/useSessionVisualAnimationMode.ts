"use client";

import { useCallback, useEffect, useRef } from "react";
import type { z } from "zod";

import {
  hasSessionSnapshotChanged,
  readSessionSnapshot,
  writeSessionSnapshot,
  type SessionValueSnapshot,
} from "./sessionValueSnapshot";

export type SessionVisualAnimationMode = "intro" | "morph" | "instant";

export interface UseSessionVisualAnimationModeOptions<
  TSnapshot extends SessionValueSnapshot,
  TMorphFrom,
> {
  shouldAnimateIntro: boolean;
  scopeId: string;
  value: number;
  signature: string;
  isDataReady: boolean;
  canInitialize: boolean;
  snapshotKeyPrefix: string;
  snapshotSchema: z.ZodType<TSnapshot>;
  buildMorphFrom: (snapshot: TSnapshot) => TMorphFrom | undefined;
  buildSnapshot: () => TSnapshot | null;
}

export function useSessionVisualAnimationMode<
  TSnapshot extends SessionValueSnapshot,
  TMorphFrom,
>({
  shouldAnimateIntro,
  scopeId,
  value,
  signature,
  isDataReady,
  canInitialize,
  snapshotKeyPrefix,
  snapshotSchema,
  buildMorphFrom,
  buildSnapshot,
}: UseSessionVisualAnimationModeOptions<TSnapshot, TMorphFrom>) {
  const animationModeRef = useRef<SessionVisualAnimationMode | null>(null);
  const morphFromRef = useRef<TMorphFrom | undefined>(undefined);

  if (
    animationModeRef.current === null &&
    canInitialize &&
    isDataReady &&
    (value === 0 || Boolean(scopeId))
  ) {
    const snapshot = scopeId
      ? readSessionSnapshot(`${snapshotKeyPrefix}${scopeId}`, snapshotSchema)
      : null;

    if (shouldAnimateIntro) {
      animationModeRef.current = "intro";
    } else if (hasSessionSnapshotChanged(snapshot, value, signature)) {
      animationModeRef.current = "morph";
      morphFromRef.current = snapshot
        ? buildMorphFrom(snapshot)
        : undefined;
    } else {
      animationModeRef.current = "instant";
    }
  }

  const animationMode = animationModeRef.current ?? "instant";
  const morphFrom = morphFromRef.current;

  const persistSnapshot = useCallback(() => {
    if (!scopeId || value === 0) return;
    const snapshot = buildSnapshot();
    if (!snapshot) return;
    writeSessionSnapshot(
      `${snapshotKeyPrefix}${scopeId}`,
      snapshotSchema,
      snapshot,
    );
  }, [
    buildSnapshot,
    scopeId,
    snapshotKeyPrefix,
    snapshotSchema,
    value,
  ]);

  useEffect(() => {
    if (!scopeId || animationMode !== "instant" || value === 0) return;
    persistSnapshot();
  }, [animationMode, persistSnapshot, scopeId, value]);

  return {
    animationMode,
    morphFrom,
    persistSnapshot,
  };
}

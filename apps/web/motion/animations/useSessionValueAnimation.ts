"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { z } from "zod";

import { runNumericTransition } from "./numericTransition";
import type { SessionIntroPlayedStore } from "./sessionIntroPlayed";
import {
  hasSessionSnapshotChanged,
  readSessionSnapshot,
  writeSessionSnapshot,
  type SessionValueSnapshot,
} from "./sessionValueSnapshot";

export interface UseSessionValueAnimationOptions<
  TSnapshot extends SessionValueSnapshot,
> {
  introStore: SessionIntroPlayedStore;
  snapshotKeyPrefix: string;
  snapshotSchema: z.ZodType<TSnapshot>;
  scopeId: string;
  value: number;
  signature: string;
  canInitialize: boolean;
  buildSnapshot: () => TSnapshot | null;
  durationMs?: number | "auto";
  introFrom?: number;
  /** persist 등 캐시 복원 시 intro·카운트업 생략 */
  skipIntroAnimation?: boolean;
}

export function useSessionValueAnimation<
  TSnapshot extends SessionValueSnapshot,
>({
  introStore,
  snapshotKeyPrefix,
  snapshotSchema,
  scopeId,
  value,
  signature,
  canInitialize,
  buildSnapshot,
  durationMs = "auto",
  introFrom = 0,
  skipIntroAnimation = false,
}: UseSessionValueAnimationOptions<TSnapshot>) {
  const shouldAnimateIntroRef = useRef<boolean | null>(null);
  if (shouldAnimateIntroRef.current === null && canInitialize && scopeId) {
    const wouldPlayIntro = introStore.shouldPlay(scopeId);
    shouldAnimateIntroRef.current = wouldPlayIntro && !skipIntroAnimation;
  }
  const shouldAnimateIntro = shouldAnimateIntroRef.current ?? false;

  const snapshotStorageKey = scopeId
    ? `${snapshotKeyPrefix}${scopeId}`
    : "";

  const readSnapshot = useCallback((): TSnapshot | null => {
    if (!scopeId) return null;
    return readSessionSnapshot(snapshotStorageKey, snapshotSchema);
  }, [scopeId, snapshotSchema, snapshotStorageKey]);

  const persistSnapshot = useCallback(() => {
    if (!scopeId || value === 0) return;
    const snapshot = buildSnapshot();
    if (!snapshot) return;
    writeSessionSnapshot(snapshotStorageKey, snapshotSchema, snapshot);
  }, [buildSnapshot, scopeId, snapshotSchema, snapshotStorageKey, value]);

  const [displayedValue, setDisplayedValue] = useState(() => {
    if (shouldAnimateIntro) return introFrom;
    const snapshot = scopeId
      ? readSessionSnapshot(snapshotStorageKey, snapshotSchema)
      : null;
    if (snapshot && hasSessionSnapshotChanged(snapshot, value, signature)) {
      return snapshot.value;
    }
    return value;
  });
  const displayedValueRef = useRef(displayedValue);

  useEffect(() => {
    if (value === 0) {
      if (!canInitialize) {
        return;
      }
      setDisplayedValue(0);
      displayedValueRef.current = 0;
      return;
    }

    const snapshot = readSnapshot();
    let from = value;
    let shouldRun = false;

    if (shouldAnimateIntro) {
      from = introFrom;
      shouldRun = true;
    } else if (hasSessionSnapshotChanged(snapshot, value, signature)) {
      from = snapshot!.value;
      shouldRun = true;
    } else if (displayedValueRef.current !== value) {
      from = displayedValueRef.current;
      shouldRun = true;
    }

    if (!shouldRun || from === value) {
      setDisplayedValue(value);
      displayedValueRef.current = value;
      return;
    }

    return runNumericTransition(
      from,
      value,
      durationMs,
      (next) => {
        setDisplayedValue(next);
        displayedValueRef.current = next;
      },
      () => {
        displayedValueRef.current = value;
        if (shouldAnimateIntro && scopeId) {
          introStore.markPlayed(scopeId);
        }
        persistSnapshot();
      },
    );
  }, [
    canInitialize,
    durationMs,
    introFrom,
    persistSnapshot,
    readSnapshot,
    scopeId,
    shouldAnimateIntro,
    signature,
    introStore,
    value,
  ]);

  return {
    displayedValue,
    shouldAnimateIntro,
    persistSnapshot,
  };
}

"use client";

import { useEffect, useRef, useState } from "react";

import { resolveSmoothCountUpDurationSec } from "./smoothCountUp";

const DEFAULT_COUNT_UP_IDENTITY = "__default__";

interface UseSmoothCountUpOptions {
  /** false면 값·애니메이션을 초기화한다 */
  enabled: boolean;
  /** 지정 시 해당 identity 첫 진입에 이 값에서 target까지 1회만 카운트업 */
  introFrom?: number;
  /** 바뀌면 이전 값에서 이어지지 않는다. 그 identity의 첫 진입이면 intro */
  identityKey?: string | number;
}

function initialIntroFrom(
  target: number,
  enabled: boolean,
  introFrom?: number,
): number | undefined {
  if (!enabled || introFrom == null || introFrom === target) return undefined;
  return introFrom;
}

function resolveCountUpIdentity(identityKey?: string | number): string | number {
  return identityKey ?? DEFAULT_COUNT_UP_IDENTITY;
}

function unusedIntroFrom(
  target: number,
  enabled: boolean,
  introFrom: number | undefined,
  identity: string | number,
  playedIdentities: Set<string | number>,
): number | undefined {
  if (playedIdentities.has(identity)) return undefined;
  return initialIntroFrom(target, enabled, introFrom);
}

function withPlayedIdentity(
  playedIdentities: Set<string | number>,
  identity: string | number,
): Set<string | number> {
  const next = new Set(playedIdentities);
  next.add(identity);
  return next;
}

/**
 * 숫자 카운트업 공통 훅.
 * - introFrom 없으면 첫 값은 즉시 표시
 * - introFrom이 있으면 identity별 첫 1회만 그 값에서 카운트업
 * - identityKey가 바뀌면 이어지지 않는다 (이미 본 identity는 점프)
 * - 같은 identity에서 target만 바뀌면 이전 값 → 새 값
 */
export function useSmoothCountUp(
  target: number,
  { enabled, introFrom, identityKey }: UseSmoothCountUpOptions,
) {
  const baselineRef = useRef<number | null>(enabled ? target : null);
  const [trackedIdentity, setTrackedIdentity] = useState(identityKey);
  const [playedIntroIdentities, setPlayedIntroIdentities] = useState(() => {
    const played = new Set<string | number>();
    if (initialIntroFrom(target, enabled, introFrom) != null) {
      played.add(resolveCountUpIdentity(identityKey));
    }
    return played;
  });
  const [animateFrom, setAnimateFrom] = useState<number | undefined>(() =>
    initialIntroFrom(target, enabled, introFrom),
  );

  if (identityKey !== trackedIdentity) {
    const nextIdentity = resolveCountUpIdentity(identityKey);
    const nextIntro = unusedIntroFrom(
      target,
      enabled,
      introFrom,
      nextIdentity,
      playedIntroIdentities,
    );
    setTrackedIdentity(identityKey);
    setAnimateFrom(nextIntro);
    if (nextIntro != null) {
      setPlayedIntroIdentities(
        withPlayedIdentity(playedIntroIdentities, nextIdentity),
      );
    }
    baselineRef.current = enabled ? target : null;
  }

  useEffect(() => {
    if (!enabled) {
      baselineRef.current = null;
      setAnimateFrom(undefined);
      return;
    }

    const previous = baselineRef.current;

    if (previous === null) {
      const nextIdentity = resolveCountUpIdentity(identityKey);
      const nextIntro = unusedIntroFrom(
        target,
        enabled,
        introFrom,
        nextIdentity,
        playedIntroIdentities,
      );
      setAnimateFrom(nextIntro);
      if (nextIntro != null) {
        setPlayedIntroIdentities((current) =>
          withPlayedIdentity(current, nextIdentity),
        );
      }
      baselineRef.current = target;
      return;
    }

    if (previous !== target) {
      setAnimateFrom(previous);
      baselineRef.current = target;
    }
  }, [enabled, target, introFrom]);

  const shouldAnimate =
    animateFrom != null && Number.isFinite(animateFrom) && animateFrom !== target;

  const durationSec = shouldAnimate
    ? resolveSmoothCountUpDurationSec(animateFrom, target)
    : 0;

  return {
    value: target,
    animateFrom: shouldAnimate ? animateFrom : undefined,
    durationSec,
    isReady: enabled,
  };
}

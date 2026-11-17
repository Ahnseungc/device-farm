import type { z } from "zod";

export interface SessionValueSnapshot {
  value: number;
  signature: string;
}

export function readSessionSnapshot<T extends SessionValueSnapshot>(
  storageKey: string,
  schema: z.ZodType<T>,
): T | null {
  try {
    if (typeof sessionStorage === "undefined") return null;
    const raw = sessionStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = schema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function writeSessionSnapshot<T extends SessionValueSnapshot>(
  storageKey: string,
  schema: z.ZodType<T>,
  snapshot: T,
): void {
  const validated = schema.safeParse(snapshot);
  if (!validated.success) return;

  try {
    if (typeof sessionStorage === "undefined") return;
    sessionStorage.setItem(storageKey, JSON.stringify(validated.data));
  } catch {
    // sessionStorage unavailable — skip
  }
}

export function hasSessionSnapshotChanged(
  snapshot: SessionValueSnapshot | null,
  value: number,
  signature: string,
): boolean {
  if (!snapshot) return false;
  return snapshot.value !== value || snapshot.signature !== signature;
}

/** rate 세그먼트 배열의 변경 감지용 signature */
export function buildRateSegmentSignature(
  segments: Array<{ id: string; rate: number }>,
): string {
  return segments
    .filter((seg) => seg.rate > 0)
    .map((seg) => `${seg.id}:${seg.rate.toFixed(6)}`)
    .join("|");
}

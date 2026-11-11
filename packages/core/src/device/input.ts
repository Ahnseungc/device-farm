/** 0~1 비율 좌표. toDevicePoint를 거친 뒤에는 기기 좌표. */
export type Point = { x: number; y: number };
export type ScreenSize = { width: number; height: number };

export const inputKeys = ["back", "home"] as const;
export type InputKey = (typeof inputKeys)[number];

export type InputEvent =
  | { type: "tap"; x: number; y: number }
  | { type: "swipe"; from: Point; to: Point; durationMs: number }
  | { type: "text"; text: string }
  | { type: "key"; key: InputKey };

const maxSwipeMs = 10_000;
const maxTextLength = 1_000;

function clamp(value: number, max: number): number {
  return Math.min(Math.max(value, 0), max);
}

/** 비율 → 기기 좌표. 범위 밖은 가장자리(0 ~ 크기-1)로 자른다. */
export function toDevicePoint(point: Point, size: ScreenSize): Point {
  return {
    x: clamp(Math.round(point.x * size.width), size.width - 1),
    y: clamp(Math.round(point.y * size.height), size.height - 1),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parsePoint(value: unknown): Point | null {
  if (!isRecord(value) || !isFiniteNumber(value.x) || !isFiniteNumber(value.y)) return null;
  return { x: value.x, y: value.y };
}

function parseSwipe(value: Record<string, unknown>): InputEvent | null {
  const from = parsePoint(value.from);
  const to = parsePoint(value.to);
  const { durationMs } = value;
  if (!from || !to || !isFiniteNumber(durationMs) || durationMs < 0 || durationMs > maxSwipeMs) return null;
  return { type: "swipe", from, to, durationMs };
}

function parseKey(value: unknown): InputKey | null {
  return inputKeys.find((key) => key === value) ?? null;
}

/** HTTP 본문 같은 바깥 값을 InputEvent로 좁힌다. 모양이 틀리면 null. */
export function parseInputEvent(value: unknown): InputEvent | null {
  if (!isRecord(value)) return null;
  if (value.type === "tap") {
    const point = parsePoint(value);
    return point ? { type: "tap", ...point } : null;
  }
  if (value.type === "swipe") return parseSwipe(value);
  if (value.type === "text") {
    const { text } = value;
    return typeof text === "string" && text.length > 0 && text.length <= maxTextLength ? { type: "text", text } : null;
  }
  if (value.type === "key") {
    const key = parseKey(value.key);
    return key ? { type: "key", key } : null;
  }
  return null;
}

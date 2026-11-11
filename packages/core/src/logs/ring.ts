import { redactText } from "./redact";
import type { LogEntry } from "../device/types";

export const logWindowMs = 30_000;

/** 최근 windowMs 동안의 로그만 들고 있다. 저장 전에 민감 값을 가린다. */
export class LogRing {
  private entries: LogEntry[] = [];

  constructor(
    private readonly windowMs = logWindowMs,
    private readonly now: () => number = Date.now,
  ) {}

  push(entry: Omit<LogEntry, "at">): void {
    const at = this.now();
    this.entries.push({ ...entry, at, text: redactText(entry.text) });
    this.entries = this.entries.filter((item) => item.at >= at - this.windowMs);
  }

  around(at: number): LogEntry[] {
    return this.entries.filter((item) => item.at >= at - this.windowMs && item.at <= at + this.windowMs);
  }

  since(at: number): LogEntry[] {
    return this.entries.filter((item) => item.at >= at);
  }
}

export type VideoFrame = { at: number; frame: Buffer; key: boolean };

/** 영상 프레임 링버퍼. 항상 키프레임에서 시작한다. */
export class FrameRing {
  private items: VideoFrame[] = [];

  constructor(private readonly windowMs = logWindowMs) {}

  push(frame: Buffer, at: number, key = true): void {
    this.items.push({ at, frame, key });
    const kept = this.items.filter((item) => item.at >= at - this.windowMs);
    const firstKey = kept.findIndex((item) => item.key);
    this.items = firstKey < 0 ? [] : kept.slice(firstKey);
  }

  frames(): VideoFrame[] {
    return [...this.items];
  }

  clear(): void {
    this.items = [];
  }
}

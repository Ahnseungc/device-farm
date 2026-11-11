import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { DeviceRun, LogEntry } from "@device-farm/core/device/types";
import type { VideoFrame } from "@device-farm/core/logs/ring";
import { execFileText, type Exec } from "@device-farm/devices/exec";

export const devicesRoot = path.resolve("test-results/devices");
export const retentionDays = 30;
export const restartMessage = "서버 재시작으로 중단됨";

const dayMs = 24 * 60 * 60_000;
const runFile = "run.json";
/** 프레임 시각으로 fps를 못 구할 때 (작성자 판단) */
const fallbackFps = 10;

export type BundleFrame = Pick<VideoFrame, "at" | "frame">;

export interface FailureBundleInput {
  logs: readonly LogEntry[];
  frames: readonly BundleFrame[];
  screenshot: Buffer;
  baseline?: { baseline: Buffer; diff: Buffer };
}

export interface FailureBundleDeps {
  encodeVideo: (frames: readonly BundleFrame[], outFile: string) => Promise<void>;
}

function runPath(root: string, runId: string): string {
  return path.join(root, runId, runFile);
}

/** `run.json`. 임시 파일에 쓰고 rename해 반쯤 쓴 파일이 남지 않게 한다. */
export function writeRun(run: DeviceRun, root = devicesRoot): void {
  const file = runPath(root, run.runId);
  mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.part`;
  writeFileSync(temp, JSON.stringify(run, null, 2));
  renameSync(temp, file);
}

function isDeviceRun(value: unknown): value is DeviceRun {
  if (typeof value !== "object" || value === null) return false;
  const run = value as Partial<DeviceRun>;
  return typeof run.runId === "string" && typeof run.startedAt === "string" && Array.isArray(run.outcomes);
}

function readRun(file: string): DeviceRun | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    return isDeviceRun(parsed) ? parsed : null;
  } catch {
    // 없거나 깨진 run.json은 목록에서 뺀다. 지우지는 않는다(보관 정리는 pruneRuns).
    return null;
  }
}

function runDirs(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name));
}

function readRuns(root: string): DeviceRun[] {
  return runDirs(root).flatMap((dir) => readRun(path.join(dir, runFile)) ?? []);
}

/** `startedAt`이 가장 늦은 실행 */
export function readLatestRun(root = devicesRoot): DeviceRun | null {
  const runs = readRuns(root).sort((left, right) => left.startedAt.localeCompare(right.startedAt));
  return runs.at(-1) ?? null;
}

/** 재시작 복구. 끝나지 않은 실행의 진행 중 기기를 skipped로 닫고 finishedAt을 채운다. 닫은 게 있으면 true. */
export function closeUnfinishedRun(root = devicesRoot, now: () => number = Date.now): boolean {
  const unfinished = readRuns(root).filter((run) => run.finishedAt === null);
  for (const run of unfinished) {
    for (const outcome of run.outcomes) {
      if (outcome.status !== "running") continue;
      outcome.status = "skipped";
      outcome.message = restartMessage;
    }
    run.finishedAt = new Date(now()).toISOString();
    writeRun(run, root);
  }
  return unfinished.length > 0;
}

function isJpeg(frame: Buffer): boolean {
  return frame[0] === 0xff && frame[1] === 0xd8;
}

function framesPerSecond(frames: readonly BundleFrame[]): number {
  const first = frames[0]?.at ?? 0;
  const last = frames.at(-1)?.at ?? 0;
  const seconds = (last - first) / 1000;
  return seconds > 0 ? Math.max(1, Math.round(frames.length / seconds)) : fallbackFps;
}

/**
 * 프레임을 이어 붙인 원시 스트림을 ffmpeg로 mp4로 만든다.
 * ponytail: 프레임 시각은 평균 fps로만 살린다(가변 간격은 고르게 펴짐). JPEG(iOS MJPEG)면 mjpeg,
 * 아니면 H.264 Annex-B 패킷(Android 스트림)으로 본다.
 * 실기기 확인: Android 첫 키프레임 앞에 SPS/PPS가 붙어 있는지. 없으면 ffmpeg가 못 읽는다.
 */
export function ffmpegEncodeVideo(exec: Exec = execFileText): FailureBundleDeps["encodeVideo"] {
  return async (frames, outFile) => {
    const dir = mkdtempSync(path.join(tmpdir(), "bundle-video-"));
    const format = isJpeg(frames[0].frame) ? "mjpeg" : "h264";
    const input = path.join(dir, `frames.${format}`);
    try {
      writeFileSync(input, Buffer.concat(frames.map((item) => item.frame)));
      const fps = String(framesPerSecond(frames));
      await exec("ffmpeg", ["-y", "-loglevel", "error", "-f", format, "-framerate", fps, "-i", input, "-c:v", "libx264", "-pix_fmt", "yuv420p", outFile]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

const defaultBundleDeps: FailureBundleDeps = { encodeVideo: ffmpegEncodeVideo() };

/** 실패 화면 하나의 묶음. 영상 인코딩이 실패해도 나머지 파일은 먼저 써 둔다. 인코딩 오류는 호출자에게 올린다. */
export async function writeFailureBundle(dir: string, input: FailureBundleInput, deps = defaultBundleDeps): Promise<void> {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "logs.jsonl"), input.logs.map((entry) => JSON.stringify(entry)).join("\n") + (input.logs.length > 0 ? "\n" : ""));
  writeFileSync(path.join(dir, "screenshot.png"), input.screenshot);
  if (input.baseline) {
    writeFileSync(path.join(dir, "baseline.png"), input.baseline.baseline);
    writeFileSync(path.join(dir, "diff.png"), input.baseline.diff);
  }
  if (input.frames.length > 0) await deps.encodeVideo(input.frames, path.join(dir, "video.mp4"));
}

function runStartedAt(dir: string): number {
  const run = readRun(path.join(dir, runFile));
  const started = run ? Date.parse(run.startedAt) : Number.NaN;
  return Number.isNaN(started) ? statSync(dir).mtimeMs : started;
}

/** `retentionDays`보다 오래된 실행 디렉터리를 지운다. 지운 실행 수. */
export function pruneRuns(root: string, now: number, days = retentionDays): number {
  const cutoff = now - days * dayMs;
  const expired = runDirs(root).filter((dir) => runStartedAt(dir) < cutoff);
  for (const dir of expired) rmSync(dir, { recursive: true, force: true });
  return expired.length;
}

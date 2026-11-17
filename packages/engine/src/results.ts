import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { countCategories, type RunSummary } from "@device-farm/core/runs/summary";
import type { DeviceOutcome, DeviceRun, LogEntry } from "@device-farm/core/device/types";
import type { VideoFrame } from "@device-farm/core/logs/ring";
import { execFileText, type Exec } from "@device-farm/devices/exec";

import { all, farmDb, fromJson, get, run as sql, toJson, transaction, type FarmDb } from "./db/farm-db";

/** 실패 묶음(스크린샷·영상·로그) 폴더. 실행 기록은 farm.db `device_runs`에 있다. */
export const devicesRoot = path.resolve("test-results/devices");
export const retentionDays = 30;
export const restartMessage = "서버 재시작으로 중단됨";

const dayMs = 24 * 60 * 60_000;
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

/** 실행 하나를 DB에 쓴다. 기기·화면 행은 지우고 다시 넣는다(진행 중에도 여러 번 부른다). */
export function writeRun(run: DeviceRun, db: FarmDb = farmDb()): void {
  transaction(db, () => {
    sql(
      db,
      `INSERT INTO device_runs (run_id, kind, version, trigger, started_at, finished_at, data) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (run_id) DO UPDATE SET kind = excluded.kind, version = excluded.version, trigger = excluded.trigger,
         started_at = excluded.started_at, finished_at = excluded.finished_at, data = excluded.data`,
      run.runId,
      run.kind,
      run.version,
      run.trigger,
      run.startedAt,
      run.finishedAt,
      JSON.stringify(run),
    );
    sql(db, "DELETE FROM device_outcomes WHERE run_id = ?", run.runId);
    sql(db, "DELETE FROM device_screens WHERE run_id = ?", run.runId);
    for (const outcome of run.outcomes) writeOutcome(db, run.runId, outcome);
  });
}

function writeOutcome(db: FarmDb, runId: string, outcome: DeviceOutcome): void {
  const { device } = outcome;
  // 같은 기기가 두 번 들어오는 일은 없지만, 있으면 뒤 값으로 덮는다(원본은 data에 그대로 있다)
  sql(
    db,
    `INSERT OR REPLACE INTO device_outcomes (run_id, device_id, platform, model, os_version, app_version, status, message) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    runId,
    device.id,
    device.platform,
    device.model,
    device.osVersion,
    device.appVersion,
    outcome.status,
    outcome.message ?? null,
  );
  for (const [position, screen] of outcome.screens.entries()) {
    sql(
      db,
      `INSERT OR REPLACE INTO device_screens (run_id, device_id, position, scenario, status, message, screenshot, log_dir, checks, steps, buttons) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      runId,
      device.id,
      position,
      screen.scenario,
      screen.status,
      screen.message ?? null,
      screen.screenshot ?? null,
      screen.logDir ?? null,
      toJson(screen.checks),
      toJson(screen.steps),
      toJson(screen.buttons),
    );
  }
}

type RunRow = { run_id: string; data: string };

const parseRun = (row: RunRow) => fromJson<DeviceRun>(row.data, `device_runs(${row.run_id})`);

/** `since`(ISO) 뒤에 시작한 실행. 오래된 것부터 */
export function readRunsSince(since: string, db: FarmDb = farmDb()): DeviceRun[] {
  return all<RunRow>(db, "SELECT run_id, data FROM device_runs WHERE started_at >= ? ORDER BY started_at", since).map(parseRun);
}

/** 최근 실행 요약(「점검 기록」). 실행 JSON을 풀지 않고 표 열로 센다 */
export function listRunSummaries(limit = 200, db: FarmDb = farmDb()): RunSummary[] {
  type Row = { run_id: string; kind: string; version: string; trigger: string; started_at: string; finished_at: string | null; label: string | null; app_version: string | null };
  const rows = all<Row>(
    db,
    `SELECT r.run_id, r.kind, r.version, r.trigger, r.started_at, r.finished_at, json_extract(r.data, '$.label') AS label,
       (SELECT o.app_version FROM device_outcomes o WHERE o.run_id = r.run_id AND o.app_version IS NOT NULL LIMIT 1) AS app_version
     FROM device_runs r ORDER BY r.started_at DESC LIMIT ?`,
    limit,
  );
  const screens = new Map<string, { scenario: string; status: string }[]>();
  for (const screen of all<{ run_id: string; scenario: string; status: string }>(db, `SELECT run_id, scenario, status FROM device_screens WHERE run_id IN (SELECT run_id FROM device_runs ORDER BY started_at DESC LIMIT ?)`, limit)) {
    screens.set(screen.run_id, [...(screens.get(screen.run_id) ?? []), screen]);
  }
  return rows.map((row) => ({
    runId: row.run_id,
    ...(row.label ? { label: row.label } : {}),
    kind: row.kind,
    version: row.version,
    appVersion: row.app_version,
    trigger: row.trigger,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    categories: countCategories(screens.get(row.run_id) ?? []),
  }));
}

export function readRun(runId: string, db: FarmDb = farmDb()): DeviceRun | null {
  const row = get<RunRow>(db, "SELECT run_id, data FROM device_runs WHERE run_id = ?", runId);
  return row ? parseRun(row) : null;
}

/** 실행의 그 화면 스크린샷(실패 묶음이 있을 때만). 결과 폴더 기준 */
export function screenshotOf(runId: string, scenario: string, db: FarmDb = farmDb()): string | null {
  return get<{ screenshot: string }>(db, "SELECT screenshot FROM device_screens WHERE run_id = ? AND scenario = ? AND screenshot IS NOT NULL LIMIT 1", runId, scenario)?.screenshot ?? null;
}

/** `startedAt`이 가장 늦은 실행 */
export function readLatestRun(db: FarmDb = farmDb()): DeviceRun | null {
  const row = get<RunRow>(db, "SELECT run_id, data FROM device_runs ORDER BY started_at DESC LIMIT 1");
  return row ? parseRun(row) : null;
}

/** 재시작 복구. 끝나지 않은 실행의 진행 중 기기를 skipped로 닫고 finishedAt을 채운다. 닫은 게 있으면 true. */
export function closeUnfinishedRun(db: FarmDb = farmDb(), now: () => number = Date.now): boolean {
  const unfinished = all<RunRow>(db, "SELECT run_id, data FROM device_runs WHERE finished_at IS NULL").map(parseRun);
  for (const run of unfinished) {
    for (const outcome of run.outcomes) {
      if (outcome.status !== "running") continue;
      outcome.status = "skipped";
      outcome.message = restartMessage;
    }
    run.finishedAt = new Date(now()).toISOString();
    writeRun(run, db);
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

function runDirs(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

/**
 * `retentionDays`보다 오래된 실행을 DB와 묶음 폴더에서 지운다. 지운 실행 수.
 * DB에 없는 폴더(옛 기록·지운 행)는 폴더 수정 시각으로 본다.
 */
export function pruneRuns(root: string, now: number, days = retentionDays, db: FarmDb = farmDb()): number {
  const cutoff = new Date(now - days * dayMs).toISOString();
  const startedAt = new Map(all<{ run_id: string; started_at: string }>(db, "SELECT run_id, started_at FROM device_runs").map((row) => [row.run_id, row.started_at]));
  const expired = new Set([...startedAt].filter(([, started]) => started < cutoff).map(([runId]) => runId));
  for (const name of runDirs(root)) {
    if (!startedAt.has(name) && statSync(path.join(root, name)).mtimeMs < now - days * dayMs) expired.add(name);
  }
  transaction(db, () => {
    for (const runId of expired) sql(db, "DELETE FROM device_runs WHERE run_id = ?", runId);
  });
  for (const runId of expired) rmSync(path.join(root, runId), { recursive: true, force: true });
  return expired.size;
}

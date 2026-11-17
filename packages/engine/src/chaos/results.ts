import path from "node:path";

import type { ChaosRun, ChaosRunSummary } from "@device-farm/core/chaos/types";

import { all, farmDb, fromJson, get, readMeta, run as sql, transaction, writeMeta, type FarmDb } from "../db/farm-db";

/** 카오스 실행 폴더. 실행마다 `<runId>/`에 오류 스크린샷. 실행 기록은 farm.db `chaos_runs`에 있다. */
export const chaosRoot = path.resolve("test-results/chaos");

const errorStepCount = (run: ChaosRun) => run.steps.filter((step) => step.errors.length > 0).length;

/** 실행 하나를 쓴다. 스텝 행은 지우고 다시 넣는다(스텝마다 부른다). */
export function writeChaosRun(run: ChaosRun, db: FarmDb = farmDb()): void {
  transaction(db, () => {
    sql(
      db,
      `INSERT INTO chaos_runs (run_id, device_id, seed, started_at, finished_at, steps, states, error_steps, blocked, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (run_id) DO UPDATE SET device_id = excluded.device_id, seed = excluded.seed, started_at = excluded.started_at, finished_at = excluded.finished_at,
         steps = excluded.steps, states = excluded.states, error_steps = excluded.error_steps, blocked = excluded.blocked, data = excluded.data`,
      run.runId,
      run.deviceId,
      run.seed,
      run.startedAt,
      run.finishedAt,
      run.steps.length,
      run.states,
      errorStepCount(run),
      run.blocked.length,
      JSON.stringify(run),
    );
    sql(db, "DELETE FROM chaos_steps WHERE run_id = ?", run.runId);
    const insert = db.prepare(
      `INSERT OR REPLACE INTO chaos_steps (run_id, episode, step, at, from_path, to_path, chosen, new_state, dead, error_count, failure, screenshot) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const step of run.steps) {
      insert.run(run.runId, step.episode, step.step, step.at, step.from, step.to, step.chosen, Number(step.newState), Number(step.dead), step.errors.length, step.failure ?? null, step.screenshot ?? null);
    }
  });
}

export function readChaosRun(runId: string, db: FarmDb = farmDb()): ChaosRun | null {
  const row = get<{ data: string }>(db, "SELECT data FROM chaos_runs WHERE run_id = ?", runId);
  return row ? fromJson<ChaosRun>(row.data, `chaos_runs(${runId})`) : null;
}

/** `since`(ISO) 뒤에 시작한 봇 점검. 오래된 것부터 */
export function readChaosRunsSince(since: string, db: FarmDb = farmDb()): ChaosRun[] {
  return all<{ run_id: string; data: string }>(db, "SELECT run_id, data FROM chaos_runs WHERE started_at >= ? ORDER BY started_at", since).map((row) =>
    fromJson<ChaosRun>(row.data, `chaos_runs(${row.run_id})`),
  );
}

/** 지난 봇 점검들이 도착한 경로(깊은 시작 후보 재료) */
export function chaosVisitedPaths(db: FarmDb = farmDb()): string[] {
  return all<{ to_path: string }>(db, "SELECT DISTINCT to_path FROM chaos_steps WHERE to_path IS NOT NULL").map((row) => row.to_path);
}

/**
 * 재시작 복구. 끝나지 않은 봇 점검의 finishedAt을 채운다. 닫은 수를 돌려준다.
 * 서버가 점검 도중 재시작되면 기록이 진행 중으로 남아, 「진행 중」 창에 2시간 동안 뜨고 중지도 안 됐다(2026-11-17).
 */
export function closeUnfinishedChaosRuns(db: FarmDb = farmDb(), now: () => number = Date.now): number {
  const rows = all<{ run_id: string; data: string }>(db, "SELECT run_id, data FROM chaos_runs WHERE finished_at IS NULL");
  for (const row of rows) {
    const run = fromJson<ChaosRun>(row.data, `chaos_runs(${row.run_id})`);
    run.finishedAt = new Date(now()).toISOString();
    writeChaosRun(run, db);
  }
  return rows.length;
}

type SummaryRow = { run_id: string; device_id: string; seed: number; started_at: string; finished_at: string | null; steps: number; states: number; error_steps: number; blocked: number };

/** 최근 실행부터 */
export function listChaosRuns(db: FarmDb = farmDb()): ChaosRunSummary[] {
  return all<SummaryRow>(db, "SELECT run_id, device_id, seed, started_at, finished_at, steps, states, error_steps, blocked FROM chaos_runs ORDER BY started_at DESC").map((row) => ({
    runId: row.run_id,
    deviceId: row.device_id,
    seed: row.seed,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    steps: row.steps,
    states: row.states,
    errorSteps: row.error_steps,
    blocked: row.blocked,
  }));
}

/** 실행 하나의 원인 한 줄 요약(Claude). farm.db `farm_meta` `chaos.summary.<runId>` */
export interface BotSummary {
  text: string;
  at: string;
}

export function readBotSummary(runId: string, db: FarmDb = farmDb()): BotSummary | null {
  const raw = readMeta(db, `chaos.summary.${runId}`);
  return raw ? fromJson<BotSummary>(raw, `farm_meta(chaos.summary.${runId})`) : null;
}

export function writeBotSummary(runId: string, summary: BotSummary, db: FarmDb = farmDb()): void {
  writeMeta(db, `chaos.summary.${runId}`, JSON.stringify(summary));
}

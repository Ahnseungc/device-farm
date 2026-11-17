import type { DailyAnalysis, DailyInput } from "@device-farm/core/report/daily";

import { farmDb, fromJson, get, run as sql, type FarmDb } from "../db/farm-db";

/** 하루치 아침 분석(farm.db `daily_reports`). 분석이 실패했으면 analysis는 null, failure에 이유 */
export interface DailyReport {
  day: string;
  createdAt: string;
  input: DailyInput;
  analysis: DailyAnalysis | null;
  failure?: string;
  /** 보낸 슬랙 글(다시 돌리면 고친다) */
  channel?: string;
  ts?: string;
}

export function readDailyReport(day: string, db: FarmDb = farmDb()): DailyReport | null {
  const row = get<{ data: string }>(db, "SELECT data FROM daily_reports WHERE day = ?", day);
  return row ? fromJson<DailyReport>(row.data, `daily_reports(${day})`) : null;
}

/** day 앞의 가장 최근 분석(어제 문제를 이어 보려고) */
export function readPreviousReport(day: string, db: FarmDb = farmDb()): DailyReport | null {
  const row = get<{ day: string; data: string }>(db, "SELECT day, data FROM daily_reports WHERE day < ? ORDER BY day DESC LIMIT 1", day);
  return row ? fromJson<DailyReport>(row.data, `daily_reports(${row.day})`) : null;
}

export function writeDailyReport(report: DailyReport, db: FarmDb = farmDb()): void {
  sql(
    db,
    `INSERT INTO daily_reports (day, created_at, channel, ts, data) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (day) DO UPDATE SET created_at = excluded.created_at, channel = excluded.channel, ts = excluded.ts, data = excluded.data`,
    report.day,
    report.createdAt,
    report.channel ?? null,
    report.ts ?? null,
    JSON.stringify(report),
  );
}

/** 가장 최근 분석 */
export function readLatestDailyReport(db: FarmDb = farmDb()): DailyReport | null {
  const row = get<{ day: string; data: string }>(db, "SELECT day, data FROM daily_reports ORDER BY day DESC LIMIT 1");
  return row ? fromJson<DailyReport>(row.data, `daily_reports(${row.day})`) : null;
}

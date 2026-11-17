import type { DeviceRun } from "@device-farm/core/device/types";
import type { PolicyCheck } from "@device-farm/core/policy/compare";
import type { DesignPage, DesignResult } from "@device-farm/core/policy/design-page";

import { all, farmDb, fromJson, type FarmDb } from "../db/farm-db";
import { readRun } from "../results";
import { policyScenarioPrefix } from "../run";

import type { PolicyScreen } from "./screen-check";

export type { DesignPage, DesignResult };

type Row = { run_id: string; device_id: string; position: number; scenario: string; status: string; message: string | null; checks: string | null; started_at: string };

/** 경로마다 가장 최근 디자인(정책) 점검 결과. 끝나지 않은 점검의 결과도 나온 만큼 쓴다 */
export function latestDesignResults(db: FarmDb = farmDb()): Map<string, DesignResult> {
  const rows = all<Row>(
    db,
    `SELECT s.run_id, s.device_id, s.position, s.scenario, s.status, s.message, s.checks, r.started_at
     FROM device_screens s JOIN device_runs r ON r.run_id = s.run_id
     WHERE s.scenario LIKE ? ORDER BY r.started_at DESC, s.position DESC`,
    `${policyScenarioPrefix}%`,
  );
  const runs = new Map<string, DeviceRun | null>();
  const runOf = (runId: string) => {
    if (!runs.has(runId)) runs.set(runId, readRun(runId, db));
    return runs.get(runId) ?? null;
  };
  const latest = new Map<string, DesignResult>();
  for (const row of rows) {
    const path = row.scenario.slice(policyScenarioPrefix.length);
    if (latest.has(path)) continue;
    const checks = row.checks ? fromJson<PolicyCheck[]>(row.checks, `device_screens(${row.run_id})`) : [];
    const screen = runOf(row.run_id)?.outcomes.find((outcome) => outcome.device.id === row.device_id)?.screens[row.position];
    latest.set(path, {
      runId: row.run_id,
      at: row.started_at,
      deviceId: row.device_id,
      status: row.status,
      ...(screen?.figmaCoverage === undefined ? {} : { figmaCoverage: screen.figmaCoverage }),
      mismatches: checks.filter((check) => !check.ok && !check.ignored).length,
      ...(row.message ? { message: row.message } : {}),
    });
  }
  return latest;
}

/** 점검할 수 있는 디자인 화면 전부(경로 순)와 마지막 결과 */
export function designPages(screens: readonly PolicyScreen[], latest: ReadonlyMap<string, DesignResult>): DesignPage[] {
  return [...screens]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((screen) => ({ path: screen.path, hasFigma: Boolean(screen.figma), rules: screen.rules.length, last: latest.get(screen.path) ?? null }));
}

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import type { ChaosRun } from "@device-farm/core/chaos/types";
import type { MapEdge, ScreenMap } from "@device-farm/core/device/screen-map";
import type { DeviceRun } from "@device-farm/core/device/types";
import type { Verdict } from "@device-farm/core/policy/judge";
import type { PageRules } from "@device-farm/core/policy/rules";
import type { PolicyChangeRecord, PolicySnapshot } from "@device-farm/core/policy/snapshot";

import { writeChaosRun } from "../chaos/results";
import type { FigmaTexts } from "../policy/figma";
import { readFigmaCache, readJudgeCache, readPageRules, readScreenHashes, writeFigmaCache, writeJudgeCache, writePageRules, writeScreenHashes } from "../policy/rules-store";
import { insertChange, readSnapshot, writeSnapshot } from "../policy/store";
import { writeRun } from "../results";
import { readScreenMap, upsertEdges } from "../screen-map-store";
import { readAlerts, saveAlert, type SentAlert } from "../slack/alert-store";
import { get, transaction, type FarmDb } from "./farm-db";

/**
 * 옛 `test-results/` JSON 파일을 farm.db로 한 번 옮긴다. 이미 DB에 있는 것은 건드리지 않는다(DB가 이긴다).
 * 그래서 다시 돌려도 겹치지 않는다. 옛 파일은 지우지 않는다.
 */
export interface ImportCounts {
  deviceRuns: number;
  chaosRuns: number;
  policySnapshot: number;
  policyChanges: number;
  policyRules: number;
  figmaCache: number;
  judgeCache: number;
  screenHashes: number;
  slackAlerts: number;
  screenMapEdges: number;
  /** 읽지 못한 파일(경로: 이유) */
  skipped: string[];
}

type Read = <T>(file: string) => T | null;

function jsonReader(skipped: string[]): Read {
  return <T>(file: string): T | null => {
    if (!existsSync(file)) return null;
    try {
      return JSON.parse(readFileSync(file, "utf8")) as T;
    } catch (error) {
      // 깨진 파일 하나 때문에 나머지를 못 옮기면 안 된다. 목록에 남겨 알린다.
      skipped.push(`${file}: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  };
}

function runFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(path.join(dir, entry.name, "run.json")))
    .map((entry) => path.join(dir, entry.name, "run.json"));
}

const has = (db: FarmDb, table: "device_runs" | "chaos_runs", runId: string) => get(db, `SELECT 1 FROM ${table} WHERE run_id = ?`, runId) !== undefined;

function importDeviceRuns(root: string, db: FarmDb, read: Read): number {
  let count = 0;
  for (const file of runFiles(path.join(root, "devices"))) {
    const run = read<DeviceRun>(file);
    if (!run?.runId || !Array.isArray(run.outcomes) || has(db, "device_runs", run.runId)) continue;
    writeRun(run, db);
    count += 1;
  }
  return count;
}

function importChaosRuns(root: string, db: FarmDb, read: Read): number {
  let count = 0;
  for (const file of runFiles(path.join(root, "chaos"))) {
    const run = read<ChaosRun>(file);
    if (!run?.runId || !Array.isArray(run.steps) || has(db, "chaos_runs", run.runId)) continue;
    writeChaosRun(run, db);
    count += 1;
  }
  return count;
}

function readChangeLines(file: string, skipped: string[]): PolicyChangeRecord[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .flatMap((line, index) => {
      try {
        return [JSON.parse(line) as PolicyChangeRecord];
      } catch {
        // 쓰다 끊긴 줄은 건너뛰고 알린다
        skipped.push(`${file}:${index + 1}: 깨진 줄`);
        return [];
      }
    });
}

/** DB에 없는 키만 더한다. 더한 수 */
function mergeMissing<T>(current: Record<string, T>, incoming: Record<string, T> | null, write: (merged: Record<string, T>) => void): number {
  const missing = Object.entries(incoming ?? {}).filter(([key]) => !(key in current));
  if (missing.length > 0) write({ ...current, ...Object.fromEntries(missing) });
  return missing.length;
}

function importPolicy(root: string, db: FarmDb, read: Read, skipped: string[]) {
  const dir = path.join(root, "policy");
  let policySnapshot = 0;
  const fileSnapshot = read<PolicySnapshot>(path.join(dir, "snapshot.json"));
  const changes = readChangeLines(path.join(dir, "changes.jsonl"), skipped);
  const policyChanges = changes.filter((record) => insertChange(db, record)).length;
  if (fileSnapshot?.checkedAt) {
    // 바뀜은 changes.jsonl에 이미 있다. 스냅샷만 넣는다
    if (!readSnapshot(db).checkedAt) {
      writeSnapshot(fileSnapshot, db);
      policySnapshot = 1;
    }
  }
  let policyRules = 0;
  const rulesDir = path.join(dir, "rules");
  for (const name of existsSync(rulesDir) ? readdirSync(rulesDir).filter((file) => file.endsWith(".json")) : []) {
    const rules = read<PageRules>(path.join(rulesDir, name));
    if (!rules?.pageId || readPageRules(rules.pageId, db)) continue;
    writePageRules(rules, db);
    policyRules += 1;
  }
  const figmaCache = mergeMissing(readFigmaCache(db), read<Record<string, FigmaTexts>>(path.join(dir, "figma.json")), (merged) => writeFigmaCache(merged, db));
  const judgeCache = mergeMissing(readJudgeCache(db), read<Record<string, Verdict[]>>(path.join(dir, "judge-cache.json")), (merged) => writeJudgeCache(merged, db));
  const screenHashes = mergeMissing(readScreenHashes(db), read<Record<string, string>>(path.join(dir, "screens.json")), (merged) => writeScreenHashes(merged, db));
  return { policySnapshot, policyChanges, policyRules, figmaCache, judgeCache, screenHashes };
}

function importAlerts(root: string, db: FarmDb, read: Read): number {
  const current = readAlerts(db);
  const missing = Object.entries(read<Record<string, SentAlert>>(path.join(root, "slack", "policy-alerts.json")) ?? {}).filter(([key]) => !current[key]);
  for (const [key, sent] of missing) saveAlert(key, sent, db);
  return missing.length;
}

const edgeKey = (edge: MapEdge) => `${edge.from}\u0000${edge.role}\u0000${edge.name}`;

function importScreenMap(root: string, db: FarmDb, read: Read): number {
  const known = new Set(readScreenMap(db).edges.map(edgeKey));
  const missing = (read<ScreenMap>(path.join(root, "screen-map.json"))?.edges ?? []).filter((edge) => !known.has(edgeKey(edge)));
  upsertEdges(missing, db);
  return missing.length;
}

/** 옛 파일을 읽어 DB에 없는 것만 넣는다. 한 트랜잭션이라 중간에 실패하면 아무것도 안 들어간다. */
export function importLegacyResults(root: string, db: FarmDb): ImportCounts {
  const skipped: string[] = [];
  const read = jsonReader(skipped);
  return transaction(db, () => ({
    deviceRuns: importDeviceRuns(root, db, read),
    chaosRuns: importChaosRuns(root, db, read),
    ...importPolicy(root, db, read, skipped),
    slackAlerts: importAlerts(root, db, read),
    screenMapEdges: importScreenMap(root, db, read),
    skipped,
  }));
}


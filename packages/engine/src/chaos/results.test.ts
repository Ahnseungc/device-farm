import assert from "node:assert/strict";

import type { ChaosRun } from "@device-farm/core/chaos/types";

import { openFarmDb } from "../db/farm-db";
import { closeUnfinishedChaosRuns, listChaosRuns, writeChaosRun } from "./results";

const db = openFarmDb(":memory:");
const base = { deviceId: "A", seed: 1, startedAt: "2026-11-17T03:00:00.000Z", steps: [], states: 0, blocked: [] } as unknown as Omit<ChaosRun, "runId" | "finishedAt">;
writeChaosRun({ ...base, runId: "done", finishedAt: "2026-11-17T03:05:00.000Z" } as ChaosRun, db);
writeChaosRun({ ...base, runId: "cut", finishedAt: null } as ChaosRun, db);

// 재시작 복구: 끝나지 않은 봇 점검만 닫는다. 두 번째는 닫을 게 없다
const now = Date.parse("2026-11-17T04:00:00.000Z");
assert.equal(closeUnfinishedChaosRuns(db, () => now), 1);
assert.equal(closeUnfinishedChaosRuns(db, () => now), 0);
const byId = Object.fromEntries(listChaosRuns(db).map((run) => [run.runId, run.finishedAt]));
assert.deepEqual(byId, { done: "2026-11-17T03:05:00.000Z", cut: "2026-11-17T04:00:00.000Z" });

db.close();
console.log("chaos results ok");

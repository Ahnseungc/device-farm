import assert from "node:assert/strict";

import { openFarmDb } from "../db/farm-db";

import { readDailyReport, readPreviousReport, writeDailyReport, type DailyReport } from "./daily-store";

const db = openFarmDb(":memory:");
const input = { from: "a", to: "b", stats: { runs: 0, screens: 0, failedScreens: 0, flowsPassed: 0, flows: 0, botRuns: 0, botSteps: 0, botErrorSteps: 0, policyBugs: 0, builds: [] }, evidence: [], previous: [], skipped: [] };
const report = (day: string, title: string): DailyReport => ({ day, createdAt: `${day}T09:00:00Z`, input, analysis: { summary: "", stable: "", issues: [{ title, kind: "data", evidence: ["B1"], action: "", new: true }] } });

writeDailyReport(report("2026-11-12", "어제"), db);
writeDailyReport(report("2026-11-13", "오늘"), db);
// 같은 날 다시 쓰면 덮어쓴다(슬랙 ts 포함)
writeDailyReport({ ...report("2026-11-13", "오늘 다시"), channel: "C1", ts: "1.2" }, db);
assert.equal(readDailyReport("2026-11-13", db)?.analysis?.issues[0].title, "오늘 다시");
assert.equal(readDailyReport("2026-11-13", db)?.ts, "1.2");
assert.equal(readPreviousReport("2026-11-13", db)?.day, "2026-11-12");
assert.equal(readPreviousReport("2026-11-12", db), null);

console.log("daily store ok");

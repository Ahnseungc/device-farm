import assert from "node:assert/strict";

import type { DeviceRun } from "@device-farm/core/device/types";

import { openFarmDb } from "../db/farm-db";
import { writeRun } from "../results";
import { policyScenarioPrefix } from "../run";

import { designPages, latestDesignResults } from "./design-pages";
import type { PolicyScreen } from "./screen-check";

const db = openFarmDb(":memory:");
const device = { id: "A", platform: "android", model: "SM-A325N", osVersion: "13", appVersion: "2.0.28+463" } as const;
const check = (ok: boolean, ignored = false) => ({ id: "c", title: "문구", ok, ignored, ignoreKey: "k", ignoreHash: "h" });
const runOf = (runId: string, startedAt: string, screens: DeviceRun["outcomes"][number]["screens"]): DeviceRun =>
  ({ runId, kind: "dev", version: "설치된 앱", trigger: "manual", startedAt, finishedAt: startedAt, outcomes: [{ device, status: "passed", screens }] }) as DeviceRun;

writeRun(runOf("old", "2026-11-17T01:00:00.000Z", [{ scenario: `${policyScenarioPrefix}/home`, status: "passed", checks: [check(true)], figmaCoverage: 0.5 }]), db);
writeRun(
  runOf("new", "2026-11-17T02:00:00.000Z", [
    { scenario: "로그인 후 홈 화면이 열린다", status: "passed" },
    { scenario: `${policyScenarioPrefix}/home`, status: "failed", message: "어긋남 1개", checks: [check(false), check(false, true), check(true)], figmaCoverage: 0.82 },
  ]),
  db,
);

// 경로마다 가장 최근 결과. 무시한 어긋남은 세지 않는다
const latest = latestDesignResults(db);
assert.deepEqual(latest.get("/home"), { runId: "new", at: "2026-11-17T02:00:00.000Z", deviceId: "A", status: "failed", figmaCoverage: 0.82, mismatches: 1, message: "어긋남 1개" });
assert.equal(latest.size, 1);

// 점검할 수 있는 화면 전부. 아직 점검하지 않은 화면은 last가 null
const screens = [
  { path: "/notice", rules: [], figma: null },
  { path: "/home", rules: [{}], figma: { hash: "f", texts: ["MY"] } },
] as unknown as PolicyScreen[];
assert.deepEqual(
  designPages(screens, latest).map((page) => [page.path, page.hasFigma, page.rules, page.last?.figmaCoverage ?? null]),
  [
    ["/home", true, 1, 0.82],
    ["/notice", false, 0, null],
  ],
);

db.close();
console.log("design pages ok");

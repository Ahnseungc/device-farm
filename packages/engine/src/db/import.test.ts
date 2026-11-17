import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { ChaosRun } from "@device-farm/core/chaos/types";
import type { DeviceRun } from "@device-farm/core/device/types";
import type { PolicySnapshot } from "@device-farm/core/policy/snapshot";

import { readChaosRun } from "../chaos/results";
import { readAllPageRules, readFigmaCache, readScreenHashes } from "../policy/rules-store";
import { readChanges, readSnapshot } from "../policy/store";
import { readLatestRun } from "../results";
import { readScreenMap } from "../screen-map-store";
import { readAlerts } from "../slack/alert-store";
import { openFarmDb } from "./farm-db";
import { importLegacyResults } from "./import";

const root = mkdtempSync(path.join(tmpdir(), "farm-import-"));
const write = (file: string, value: unknown) => {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), typeof value === "string" ? value : JSON.stringify(value));
};

const deviceRun: DeviceRun = {
  runId: "20261023T000000000-aaaa",
  kind: "dev",
  version: "2.1.5",
  trigger: "manual",
  startedAt: "2026-10-23T00:00:00.000Z",
  finishedAt: "2026-10-23T00:01:00.000Z",
  outcomes: [{ device: { id: "R3CN", platform: "android", model: "A32", osVersion: "13", appVersion: "2.1.5" }, status: "failed", screens: [{ scenario: "홈", status: "failed", screenshot: "R3CN/home/screenshot.png" }] }],
};
const chaosRun: ChaosRun = { runId: "2026-11-11T00-00-00-000Z-s7", deviceId: "R3CN", seed: 7, startedAt: "2026-11-11T00:00:00.000Z", finishedAt: null, steps: [], states: 0, blocked: [] };
const snapshot: PolicySnapshot = { checkedAt: "2026-11-11T01:00:00.000Z", pages: { "1": { id: "1", title: "출금", version: 2, modifiedAt: "2026-11-01T00:00:00.000Z", hash: "h", webUrl: "" } } };

try {
  write(`devices/${deviceRun.runId}/run.json`, deviceRun);
  write("devices/broken/run.json", "{");
  write("devices/no-run/R3CN/screenshot.png", "png");
  write(`chaos/${chaosRun.runId}/run.json`, chaosRun);
  write("policy/snapshot.json", snapshot);
  write("policy/changes.jsonl", `${JSON.stringify({ at: "2026-11-11T00:00:00.000Z", kind: "added", id: "1", title: "출금", version: 1, hash: "g" })}\n{깨짐\n${JSON.stringify({ at: snapshot.checkedAt, kind: "changed", id: "1", title: "출금", version: 2, fromVersion: 1, hash: "h" })}\n`);
  write("policy/rules/1.json", { pageId: "1", pageTitle: "출금", pageHash: "h", extractedAt: snapshot.checkedAt, screens: [], figma: [], rules: [], dropped: [] });
  write("policy/figma.json", { "A:1": { hash: "f", texts: ["출금하기"] } });
  write("policy/screens.json", { "/home": "s1" });
  write("slack/policy-alerts.json", { k: { alert: { key: "k", path: "/home", finding: "app-bug" }, channel: "C", ts: "1.2", sentAt: snapshot.checkedAt, status: "open" } });
  write("screen-map.json", { edges: [{ from: "/home", role: "button", name: "출금", kind: "navigate", to: "/my/withdraw", seenAt: snapshot.checkedAt }] });

  const db = openFarmDb(":memory:");
  const first = importLegacyResults(root, db);
  assert.deepEqual(
    { ...first, skipped: first.skipped.length },
    { deviceRuns: 1, chaosRuns: 1, policySnapshot: 1, policyChanges: 2, policyRules: 1, figmaCache: 1, judgeCache: 0, screenHashes: 1, slackAlerts: 1, screenMapEdges: 1, skipped: 2 },
  );
  assert.deepEqual(readLatestRun(db), deviceRun);
  assert.deepEqual(readChaosRun(chaosRun.runId, db), chaosRun);
  assert.deepEqual(readSnapshot(db), snapshot);
  // 스냅샷을 넣을 때 "추가"를 또 남기지 않는다
  assert.deepEqual(readChanges(10, db).map((change) => change.kind), ["changed", "added"]);
  assert.equal(readAllPageRules(db).length, 1);
  assert.deepEqual(readFigmaCache(db), { "A:1": { hash: "f", texts: ["출금하기"] } });
  assert.deepEqual(readScreenHashes(db), { "/home": "s1" });
  assert.equal(readAlerts(db).k.status, "open");
  assert.equal(readScreenMap(db).edges[0].to, "/my/withdraw");

  // 다시 돌려도 겹치지 않는다. DB에 있는 값은 파일로 덮지 않는다
  write("policy/screens.json", { "/home": "old", "/benefit": "s2" });
  const second = importLegacyResults(root, db);
  assert.deepEqual([second.deviceRuns, second.chaosRuns, second.policySnapshot, second.policyChanges, second.policyRules, second.slackAlerts, second.screenMapEdges, second.screenHashes], [0, 0, 0, 0, 0, 0, 0, 1]);
  assert.deepEqual(readScreenHashes(db), { "/home": "s1", "/benefit": "s2" });
  assert.equal(readChanges(10, db).length, 2);
  db.close();
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log("db import ok");

import assert from "node:assert/strict";

import { categoryOf, countCategories, groupByVersion, type RunSummary } from "./summary";

assert.equal(categoryOf("플로우 점검 · 알림 열기"), "flow");
assert.equal(categoryOf("정책 점검 · /my"), "policy");
assert.equal(categoryOf("화면 깨짐 점검 · /my"), "layout");
// 예전 이름으로 남은 기록도 같은 종류
assert.equal(categoryOf("배치 점검 · /my"), "layout");
assert.equal(categoryOf("로그인 후 고객 문의 화면이 열린다"), "screen");

assert.deepEqual(
  countCategories([
    { scenario: "플로우 점검 · a", status: "passed" },
    { scenario: "플로우 점검 · b", status: "failed" },
    { scenario: "정책 점검 · /x", status: "passed" },
  ]),
  { flow: { total: 2, failed: 1 }, policy: { total: 1, failed: 0 } },
);

const run = (runId: string, appVersion: string | null, startedAt: string, categories: RunSummary["categories"]): RunSummary => ({ runId, kind: "dev", version: "설치된 앱", appVersion, trigger: "manual", startedAt, finishedAt: startedAt, categories });
const runs = [
  run("a", "2.0.28+462", "2026-11-11T01:00:00Z", { flow: { total: 24, failed: 22 } }),
  run("b", "2.0.28+463", "2026-11-12T01:00:00Z", { flow: { total: 24, failed: 0 } }),
  run("c", "2.0.28+463", "2026-11-12T05:00:00Z", { policy: { total: 99, failed: 8 } }),
];
// 최근 버전 먼저, 안에서도 최근 실행 먼저, 실패 수는 묶음 합
const groups = groupByVersion(runs);
assert.deepEqual(groups.map((group) => [group.key, group.runs.map((item) => item.runId), group.failed]), [
  ["dev 2.0.28+463", ["c", "b"], 8],
  ["dev 2.0.28+462", ["a"], 22],
]);
// 종류를 고르면 그 종류가 있는 실행만, 실패 수도 그 종류만
assert.deepEqual(groupByVersion(runs, "flow").map((group) => [group.key, group.runs.length, group.failed]), [
  ["dev 2.0.28+463", 1, 0],
  ["dev 2.0.28+462", 1, 22],
]);

console.log("run summary ok");

import assert from "node:assert/strict";

import type { DeviceRun } from "@device-farm/core/device/types";
import type { PolicyWatchState } from "@device-farm/core/policy/snapshot";

import { botActivities, finishedToast, policyActivity, runActivity } from "./activity-model";

const device = { id: "d1", platform: "android", model: "SM-A325N", osVersion: "13" } as DeviceRun["outcomes"][number]["device"];
const run = (finishedAt: string | null, statuses: ("passed" | "failed")[]): DeviceRun => ({
  runId: "r1",
  kind: "dev",
  version: "2.0.28",
  trigger: "manual",
  startedAt: new Date().toISOString(),
  finishedAt,
  scenarioCount: 4,
  outcomes: [{ device, status: finishedAt ? "passed" : "running", current: "플로우 점검 · 홈", screens: statuses.map((status, index) => ({ scenario: `s${index}`, status })) }],
});

// 도는 점검: 지금 보는 것과 진행률
const active = runActivity(run(null, ["passed"]));
assert.equal(active?.detail, "플로우 점검 · 홈");
assert.equal(active?.ratio, 0.25);
// 플로팅 「중지」는 종류마다 다른 작업을 멈춘다
assert.equal(active?.stop, "run");
assert.equal(runActivity(run("2026-11-12T00:00:00Z", ["passed"])), null);
// CLI 점검은 제목에 점검 이름이 나온다. 강제로 끝나 오래 남은 실행은 진행 중으로 보지 않는다
assert.equal(runActivity({ ...run(null, ["passed"]), label: "정책 점검" })?.title, "정책 점검");
assert.equal(runActivity({ ...run(null, ["passed"]), startedAt: "2026-11-01T00:00:00Z" }), null);

// 끝난 점검: 실패가 있으면 빨강
const done = finishedToast("run:r1", { run: run("2026-11-12T00:00:00Z", ["passed", "failed", "passed"]) });
assert.equal(done.tone, "critical");
assert.equal(done.detail, "3개 중 통과 2 · 실패 1");

// 정책 규칙 뽑기 진행·완료
const policy = { running: true, progress: { done: 8, total: 48 }, rules: [], extractFailed: [], lastError: null } as unknown as PolicyWatchState;
assert.equal(policyActivity(policy)?.detail, "9 / 48 정책");
const policyDone = finishedToast("policy", { policy: { ...policy, running: false, rules: [{ rules: [1, 2] }, { rules: [3] }] } as unknown as PolicyWatchState });
assert.equal(policyDone.detail, "정책 2개 · 규칙 3개");

// 중간에 멈춰 finishedAt 없이 남은 오래된 봇 점검은 진행 중이 아니다
const now = new Date().toISOString();
const old = new Date(Date.now() - 3 * 60 * 60_000).toISOString();
const bots = botActivities([
  { runId: "a", deviceId: "d1", seed: 1, startedAt: now, finishedAt: null, steps: 3, states: 2, errorSteps: 0, blocked: 0 },
  { runId: "b", deviceId: "d1", seed: 2, startedAt: old, finishedAt: null, steps: 30, states: 9, errorSteps: 1, blocked: 0 },
]);
assert.deepEqual(bots.map((item) => item.id), ["bot:a"]);
assert.equal(bots[0].stop, "bot");
assert.equal(bots[0].detail, "d1 · 3스텝 · 오류 스텝 0");
// 첫 스텝 전(연결·홈 이동 중)에도 보인다
assert.equal(botActivities([{ runId: "c", deviceId: "d1", seed: 3, startedAt: now, finishedAt: null, steps: 0, states: 0, errorSteps: 0, blocked: 0 }])[0].detail, "d1 준비 중");
assert.equal(policyActivity(policy)?.stop, "policy");

console.log("activity model ok");

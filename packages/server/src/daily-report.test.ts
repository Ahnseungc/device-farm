import assert from "node:assert/strict";

import type { DeviceRun } from "@device-farm/core/device/types";
import { openFarmDb, useFarmDb } from "@device-farm/engine/db/farm-db";
import { readDailyReport } from "@device-farm/engine/report/daily-store";
import { writeRun } from "@device-farm/engine/results";
import type { SlackClient } from "@device-farm/engine/slack/client";

import { runDailyReport } from "./daily-report";

useFarmDb(openFarmDb(":memory:"));
const run: DeviceRun = {
  runId: "r1",
  kind: "dev",
  version: "설치된 앱",
  trigger: "auto",
  startedAt: "2026-11-13T03:00:00.000Z",
  finishedAt: "2026-11-13T03:10:00.000Z",
  outcomes: [{ device: { id: "A", platform: "android", model: "SM-A325N", osVersion: "13", appVersion: "2.0.28+463" }, status: "failed", screens: [{ scenario: "플로우 점검 · 출석체크 열기", status: "failed", message: "출석체크 실패" }] }],
};
writeRun(run);

const sent: string[] = [];
const slack = {
  post: async (channel: string, text: string) => (sent.push(`post ${text.split("\n")[0]}`), { channel, ts: "1.1" }),
  update: async (_channel: string, ts: string) => {
    sent.push(`update ${ts}`);
  },
  reply: async () => undefined,
  findUserIdByName: async () => null,
} as SlackClient;
const now = () => new Date("2026-11-13T09:01:00");
const answer = '{"summary":"출석체크 실패","issues":[{"title":"출석체크 안 열림","kind":"app-bug","evidence":["R1"],"action":"확인 필요","new":true}],"stable":""}';

const first = await runDailyReport("2026-11-13", { now, ask: async () => answer, slack, channel: "C1", send: true, log: () => undefined });
assert.equal(first.analysis?.issues[0].title, "출석체크 안 열림");
assert.equal(readDailyReport("2026-11-13")?.ts, "1.1");

// 같은 날 다시: 저장을 덮고 슬랙 글은 고친다. Claude가 실패하면 숫자와 이유만
const again = await runDailyReport("2026-11-13", { now, ask: async () => Promise.reject(new Error("Not logged in")), slack, channel: "C1", send: true, log: () => undefined });
assert.equal(again.analysis, null);
assert.match(again.failure ?? "", /setup-token/);
assert.deepEqual(sent, ["post 디바이스팜 아침 요약 · 11/13(금) — 새 문제 1", "update 1.1"]);

console.log("daily report server ok");

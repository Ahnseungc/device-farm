import assert from "node:assert/strict";

import type { FailureAlert } from "@device-farm/core/slack/failure-alert";
import type { FixPrRunner } from "@device-farm/engine/fix-pr/fix-pr";
import type { SentAlert } from "@device-farm/engine/slack/alert-store";
import type { SlackClient } from "@device-farm/engine/slack/client";

import { createFixPrButton } from "./fix-pr-button";

const alert: FailureAlert = { type: "failure", key: "k1", path: "앱 · 홈", finding: "app-error", message: "흰 화면", device: "iPhone", build: "dev 1", runId: "r1" };

function setup(runner: FixPrRunner) {
  const store: Record<string, SentAlert> = { k1: { alert, channel: "C1", ts: "1.1", sentAt: "", status: "open" } };
  const events: string[] = [];
  const client = {
    post: async () => ({ channel: "C1", ts: "9" }),
    update: async (_channel: string, _ts: string, text: string) => void events.push(`update ${text}`),
    reply: async (_channel: string, threadTs: string, text: string) => void events.push(`reply ${threadTs} ${text.split("\n")[0]}`),
    findUserIdByName: async () => null,
  } satisfies SlackClient;
  const button = createFixPrButton({
    client,
    runner,
    readAlerts: () => store,
    saveAlert: (key, sent) => {
      store[key] = sent;
      events.push(`save ${sent.fix?.state}`);
    },
    render: (sent) => ({ text: `fix=${sent.fix?.state}`, blocks: [] }),
    log: () => undefined,
  });
  return { store, events, button };
}

// 누르면 running → opened, 스레드에 시작·결과
{
  let calls = 0;
  const { store, events, button } = setup(async () => {
    calls++;
    return { state: "opened", prs: [{ base: "development", number: 1, url: "https://g/1" }, { base: "main", number: 2, url: "https://g/2" }], summary: "고쳤어요", skipped: [] };
  });
  await button.start("k1", "U1");
  assert.equal(calls, 1);
  assert.equal(store.k1.fix?.state, "opened");
  assert.equal(store.k1.fix?.by, "U1");
  assert.deepEqual(store.k1.fix?.prs?.map((pr) => pr.number), [1, 2]);
  assert.equal(store.k1.status, "open");
  assert.deepEqual(events.slice(0, 3), ["save running", "update fix=running", "reply 1.1 <@U1> 수정 PR 만드는 중이에요(최대 15분). 앞에 다른 수정이 있으면 끝난 뒤 시작해요."]);
  assert.ok(events.at(-1)?.startsWith("reply 1.1 :white_check_mark: 수정 PR을 열었어요: <https://g/1|development #1>"));
  // 이미 열렸으면 다시 돌리지 않는다
  await button.start("k1", "U2");
  assert.equal(calls, 1);
  assert.equal(events.at(-1), "reply 1.1 이미 수정 PR이 열려 있어요.");
}

// 못 고침·실패는 기록하고 다시 누를 수 있다
{
  const { store, button } = setup(async () => ({ state: "no-change", summary: "서버 문제예요\n자세히", category: "server" }));
  await button.start("k1", "U1");
  assert.equal(store.k1.fix?.state, "no-change");
  assert.equal(store.k1.fix?.note, "서버 문제예요");
}
{
  let fail = true;
  const { store, button } = setup(async () => {
    if (fail) throw new Error("GitHub GET /user 401: Bad credentials");
    return { state: "no-change", summary: "x", category: "unsure" };
  });
  await button.start("k1", "U1");
  assert.equal(store.k1.fix?.state, "failed");
  // 슬랙에는 풀어 쓴 한국어
  assert.equal(store.k1.fix?.note, "GitHub 토큰이 맞지 않거나 만료됐어요. 디바이스팜 맥 .env의 FARM_FIX_PR_GITHUB_TOKEN을 새로 넣어 주세요.");
  fail = false;
  await button.start("k1", "U1");
  assert.equal(store.k1.fix?.state, "no-change");
}

// 한 번에 하나씩
{
  let active = 0;
  let peak = 0;
  const { store, button } = setup(async () => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active--;
    return { state: "no-change", summary: "x", category: "unsure" };
  });
  store.k2 = { alert: { ...alert, key: "k2" }, channel: "C1", ts: "2.2", sentAt: "", status: "open" };
  await Promise.all([button.start("k1", "U1"), button.start("k2", "U1")]);
  assert.equal(peak, 1);
}

// 정책 알림·모르는 키는 무시, 재시작 때 running은 failed로
{
  let calls = 0;
  const { store, button } = setup(async () => {
    calls++;
    return { state: "no-change", summary: "x", category: "unsure" };
  });
  await button.start("nope", "U1");
  assert.equal(calls, 0);
  store.k1 = { ...store.k1, fix: { state: "running", by: "U1" } };
  await button.recover();
  assert.equal(store.k1.fix?.state, "failed");
  assert.equal(store.k1.fix?.note, "서버가 다시 켜져 멈췄어요");
}

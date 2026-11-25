import assert from "node:assert/strict";

import type { FlowDocument } from "@device-farm/core/flows/schema";

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { ReportResult } from "@device-farm/engine/qa-report/report";

import { sampleApp } from "@device-farm/core/config/sample-app";

import { createQaReportHandler, downloadReportImages, filePendingStore, isSlackFileUrl, qaMessageOf } from "./qa-report";

// 소켓 봉투 → 제보 후보. 봇 글·수정(subtype)은 뺀다
assert.deepEqual(qaMessageOf({ event: { type: "message", channel: "C1", user: "U1", text: "hi", ts: "1.2", thread_ts: "1.0" } }), { channel: "C1", user: "U1", text: "hi", ts: "1.2", threadTs: "1.0" });
assert.equal(qaMessageOf({ event: { type: "message", subtype: "message_changed", channel: "C1", text: "hi", ts: "1.2" } }), null);
assert.equal(qaMessageOf({ event: { type: "message", bot_id: "B1", channel: "C1", text: "hi", ts: "1.2" } }), null);
assert.equal(qaMessageOf({ event: { type: "reaction_added" } }), null);
// 파일 붙인 글(file_share)은 받고, 이미지만 담는다
assert.deepEqual(
  qaMessageOf({
    event: {
      type: "message",
      subtype: "file_share",
      channel: "C1",
      text: "<@U0AHN> 이거",
      ts: "1.3",
      files: [
        { name: "a.png", mimetype: "image/png", url_private_download: "https://files.slack.com/files-pri/T1-F1/download/a.png" },
        { name: "log.txt", mimetype: "text/plain", url_private_download: "https://files.slack.com/files-pri/T1-F2/download/log.txt" },
      ],
    },
  })?.images,
  [{ name: "a.png", mimetype: "image/png", url: "https://files.slack.com/files-pri/T1-F1/download/a.png" }],
);

// 봇 토큰은 슬랙 파일 주소에만 보낸다
assert.equal(isSlackFileUrl("https://files.slack.com/files-pri/x"), true);
assert.equal(isSlackFileUrl("https://evil.example.com/files.slack.com"), false);
assert.equal(isSlackFileUrl("http://files.slack.com/x"), false);
{
  const dir = mkdtempSync(path.join(tmpdir(), "qa-images-"));
  try {
    const sentTo: string[] = [];
    const image = (contentType: string) => async (url: string) => {
      sentTo.push(url);
      return { ok: true, status: 200, headers: { get: () => contentType }, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
    };
    const images = [
      { name: "a.png", mimetype: "image/png", url: "https://files.slack.com/a" },
      { name: "b.png", mimetype: "image/png", url: "https://evil.example.com/b" },
    ];
    const saved = await downloadReportImages(images, dir, "xoxb", image("image/png"));
    assert.deepEqual(saved, [path.join(dir, "1.png")]);
    assert.deepEqual([...readFileSync(saved[0])], [1, 2, 3]);
    assert.deepEqual(sentTo, ["https://files.slack.com/a"]);
    // 권한이 없으면 슬랙이 로그인 HTML을 준다 → files:read 안내
    await assert.rejects(downloadReportImages(images.slice(0, 1), dir, "xoxb", image("text/html")), /files:read/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const flowAnswer = JSON.stringify({ name: "친구 초대", steps: [{ type: "click", target: { role: "link", name: "혜택" } }, { type: "expectText", text: "나의 초대 코드" }] });

const shotDir = mkdtempSync(path.join(tmpdir(), "qa-shot-"));
const shot = path.join(shotDir, "screenshot.png");
writeFileSync(shot, "png");

/** answers: 플로우 만들기 답을 차례로(마지막 것을 계속). opinion: 의견 답 */
function setup(answers: string | Error | (string | Error)[], opinion = '{"opinion":"제보한 대로 초대 코드가 안 보여요.\\n앱을 고쳐야 해요.","verdict":"reproduced","appBug":true}', thread?: Record<string, unknown>[], results: ReportResult[] = []) {
  const queue = Array.isArray(answers) ? [...answers] : [answers];
  const replies: { thread: string; text: string }[] = [];
  const uploads: string[] = [];
  const saved: FlowDocument[] = [];
  const ran: string[] = [];
  const buttons: string[] = [];
  const prompts: string[] = [];
  let asked = 0;
  const handle = createQaReportHandler({
    app: sampleApp,
    client: {
      reply: async (_channel, thread, text) => void replies.push({ thread, text }),
      uploadImage: async (_channel, thread, _file, _name, title) => void uploads.push(`${thread} ${title}`),
      ...(thread ? { threadMessages: async () => thread } : {}),
    },
    ask: async (prompt) => {
      prompts.push(prompt);
      if (prompt.includes("의견을")) return opinion;
      asked += 1;
      const answer = queue.length > 1 ? queue.shift()! : queue[0];
      if (answer instanceof Error) throw answer;
      return answer;
    },
    postFixButton: async (_channel, thread, runId) => void buttons.push(`${thread} ${runId}`),
    downloadImages: async (message) => (message.images ?? []).map((_, index) => `/farm/test-results/qa-reports/${index + 1}.png`),
    channel: "CQA",
    mentionIds: ["U0AHN"],
    screenMap: () => "",
    saveCandidate: (flow) => void saved.push(flow),
    runFlow: async (flow) => (ran.push(flow.id), results[ran.length - 1] ?? { status: "failed", note: "플로우 1개 중 1개 실패", runId: "r1", screenshot: shot }),
    log: () => undefined,
  });
  return { handle, replies, uploads, saved, ran, buttons, prompts, asked: () => asked };
}

// @담당자 태그 제보: 후보로 남기고 바로 돌려 원글 스레드에 흐름과 결과를 단다. 같은 글은 한 번만
{
  const t = setup(flowAnswer);
  const message = { channel: "CQA", text: "<@U0AHN> 친구 초대 안 열림", ts: "100.1" };
  await t.handle(message);
  await t.handle(message);
  assert.equal(t.asked(), 1);
  assert.deepEqual(t.saved.map((flow) => flow.id), ["qa-report-1001"]);
  assert.deepEqual(t.ran, ["qa-report-1001"]);
  assert.deepEqual(t.replies.map((reply) => reply.thread), ["100.1", "100.1", "100.1"]);
  // 받자마자 「확인 중」 답을 먼저 단다
  assert.match(t.replies[0].text, /^:eyes: 확인 중이에요/);
  assert.match(t.replies[1].text, /돌려 볼게요[\s\S]*1\. 누르기 「혜택」/);
  assert.match(t.replies[2].text, /^:x: \*점검 결과: 재현됨\*/);
  // 비개발자용 의견은 한 문단으로 결과 아래에
  assert.match(t.replies[2].text, /:speech_balloon: 제보한 대로 초대 코드가 안 보여요\. 앱을 고쳐야 해요\./);
  // 실패한 화면을 같은 스레드에 올리고, 「수정 PR 만들기」 버튼 알림도 단다
  assert.deepEqual(t.uploads, ["100.1 실패한 화면"]);
  assert.deepEqual(t.buttons, ["100.1 r1"]);
}

// 버튼을 못 찾아 멈추면 그 화면의 실제 이름을 주고 흐름을 한 번 고쳐 다시 돌린다. 결과는 다시 돌린 것으로 답한다
{
  const missing: ReportResult = { status: "failed", note: "실패", runId: "r1", missing: { message: '4단계 누르기 「설정」 실패: "설정" 버튼를 찾지 못했습니다.', seen: ["button 계정 설정", "button 공지사항"] } };
  const fixed = JSON.stringify({ name: "탈퇴 사유", steps: [{ type: "click", target: { role: "button", name: "계정 설정" } }, { type: "expectText", text: "계정 탈퇴" }] });
  const t = setup([flowAnswer, fixed], '{"opinion":"정상이에요.","verdict":"not_reproduced","appBug":false}', undefined, [missing, { status: "passed", note: "통과", runId: "r2" }]);
  await t.handle({ channel: "CQA", text: "<@U0AHN> 탈퇴 사유가 안 펼쳐져요", ts: "160.1" });
  assert.equal(t.ran.length, 2);
  assert.match(t.prompts[1], /멈춘 화면에서 실제로 누를 수 있던 것[\s\S]*- button 계정 설정/);
  assert.match(t.replies[2].text, /^:wrench:[\s\S]*「계정 설정」/);
  assert.match(t.replies[3].text, /재현 안 됨[\s\S]*r2/);

  // 고친 흐름이 같거나 만들지 못하면 다시 돌리지 않는다. 판정이 없으면 앱 실패가 아니라 「확인 못 함」
  for (const again of [flowAnswer, '{"skip":"제보한 버튼이 화면에 없음"}']) {
    const once = setup([flowAnswer, again], "의견만 있어요.", undefined, [missing]);
    await once.handle({ channel: "CQA", text: "<@U0AHN> 안 열려요", ts: "161.1" });
    assert.equal(once.ran.length, 1);
    assert.match(once.replies.at(-1)?.text ?? "", /^:grey_question: \*점검 결과: 확인 못 함\*/);
  }
}

// 흐름이 제보 상황까지 못 가 실패하면(unclear) 「확인 못 함」이고, 앱 버그라고 안 보면 PR 버튼을 달지 않는다
{
  const t = setup(flowAnswer, '{"opinion":"배너를 못 찾아 멈췄어요.","verdict":"unclear","appBug":false}');
  await t.handle({ channel: "CQA", text: "<@U0AHN> 배너 눌러도 이동이 안 돼요", ts: "150.9" });
  assert.match(t.replies.find((reply) => reply.text.includes("점검 결과"))?.text ?? "", /^:grey_question: \*점검 결과: 확인 못 함\* — 점검이 제보한 상황까지/);
  assert.deepEqual(t.buttons, []);
}

// 새 정보 없는 답(인사)은 다시 돌리지 않고, 앞 결과 질문은 짧게 답만 한다. 스레드는 계속 이어 받는다
{
  const t = setup(['{"ask":"어디서요?"}', '{"reply":""}', '{"reply":"아직 확인 중이에요."}', flowAnswer]);
  await t.handle({ channel: "CQA", text: "<@U0AHN> 안 돼요", ts: "170.1" });
  await t.handle({ channel: "CQA", text: "오키 굿", ts: "170.2", threadTs: "170.1" });
  assert.deepEqual(t.ran, []);
  await t.handle({ channel: "CQA", text: "지금 오류야?", ts: "170.3", threadTs: "170.1" });
  assert.deepEqual(t.ran, []);
  assert.match(t.replies.at(-1)?.text ?? "", /^:speech_balloon: 아직 확인 중이에요\./);
  await t.handle({ channel: "CQA", text: "카테고리 홈 배너요", ts: "170.4", threadTs: "170.1" });
  assert.deepEqual(t.ran, ["qa-report-1701"]);
}

// 검증에 걸린 답(금지 버튼)은 이유를 붙여 한 번 더 만들게 한다
{
  const t = setup(['{"name":"n","steps":[{"type":"click","target":{"role":"button","name":"탈퇴하기"}},{"type":"expectText","text":"x"}]}', flowAnswer]);
  await t.handle({ channel: "CQA", text: "<@U0AHN> 탈퇴 사유가 누락돼요", ts: "180.1" });
  assert.equal(t.asked(), 2);
  assert.match(t.prompts[1], /거절 이유: .*버튼은 쓸 수 없습니다\(금지 버튼\)/);
  assert.deepEqual(t.ran, ["qa-report-1801"]);
}

// 정보가 모자라면 되묻고, 그 스레드에 단 답(태그 없이)을 원래 제보와 합쳐 이어서 돌린다
{
  const t = setup(['{"ask":"어느 단계에서 막히나요?"}', flowAnswer]);
  await t.handle({ channel: "CQA", text: "<@U0AHN> 등록이 안 돼요", ts: "500.1" });
  assert.deepEqual(t.ran, []);
  assert.match(t.replies[1].text, /^:question: 어느 단계에서 막히나요\?\n이 스레드에 답을/);
  // 되묻지 않은 다른 스레드의 태그 없는 답은 무시
  await t.handle({ channel: "CQA", text: "다른 얘기", ts: "600.2", threadTs: "600.1" });
  assert.equal(t.asked(), 1);
  await t.handle({ channel: "CQA", text: "등록하기 누르면 오류 문구가 떠요", ts: "500.2", threadTs: "500.1" });
  assert.deepEqual(t.ran, ["qa-report-5001"]);
  assert.match(t.prompts.at(-2) ?? "", /등록이 안 돼요[\s\S]*\[추가 설명\] 등록하기 누르면 오류 문구가 떠요/);
  assert.ok(t.replies.every((reply) => reply.thread === "500.1"));
  // 같은 스레드에 또 답해도(되묻지 않았으면) 다시 돌리지 않는다
  await t.handle({ channel: "CQA", text: "고마워요", ts: "500.3", threadTs: "500.1" });
  assert.deepEqual(t.ran, ["qa-report-5001"]);
}

// 처리하는 동안 그 스레드에 단 답은 버리지 않고, 끝난 뒤 합쳐서 이어서 처리한다(되묻지 않았어도)
{
  const t = setup(flowAnswer, '{"opinion":"통과했어요."}');
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  const ranTexts: string[] = [];
  const handle = createQaReportHandler({
    app: sampleApp,
    client: { reply: async () => undefined, uploadImage: async () => undefined },
    ask: async (prompt) => (prompt.includes("의견을") ? '{"opinion":"통과했어요."}' : (ranTexts.push(prompt), flowAnswer)),
    channel: "CQA",
    mentionIds: ["U0AHN"],
    screenMap: () => "",
    saveCandidate: () => undefined,
    runFlow: async (flow) => {
      if (ranTexts.length === 1) await gate;
      return { status: "passed", note: "통과", runId: flow.id };
    },
    log: () => undefined,
  });
  const first = handle({ channel: "CQA", text: "<@U0AHN> 등록이 안 돼요", ts: "900.1" });
  await new Promise((resolve) => setImmediate(resolve));
  await handle({ channel: "CQA", text: "토스트 확인해 주세요", ts: "900.2", threadTs: "900.1" });
  await handle({ channel: "CQA", text: "등록 완료 후 토스트가 안 나와요", ts: "900.3", threadTs: "900.1" });
  assert.equal(ranTexts.length, 1, "처리 중에는 모아만 둔다");
  release();
  await first;
  assert.equal(ranTexts.length, 2);
  assert.match(ranTexts[1], /등록이 안 돼요[\s\S]*\[추가 설명\] 토스트 확인해 주세요[\s\S]*\[추가 설명\] 등록 완료 후 토스트가 안 나와요/);
  void t;
}

// 처리하다 서버가 꺼지면 「처리 중」 기록이 남고, 다시 켜질 때(resume) 저절로 이어서 처리한다. 끝나면 기록을 지운다
{
  const dir = mkdtempSync(path.join(tmpdir(), "qa-pending-"));
  try {
    const store = filePendingStore(path.join(dir, "pending.json"));
    store.set("950.1", { text: "등록이 안 돼요", images: [], rounds: 0, inProgress: true, channel: "CQA" });
    store.set("960.1", { text: "되물어 둔 것", images: [], rounds: 1, channel: "CQA" });
    const replies: string[] = [];
    const ran: string[] = [];
    const handler = createQaReportHandler({
      app: sampleApp,
      client: { reply: async (_c, thread, text) => void replies.push(`${thread} ${text.split("\n")[0]}`), uploadImage: async () => undefined },
      ask: async (prompt) => (prompt.includes("의견을") ? '{"opinion":"통과했어요."}' : flowAnswer),
      channel: "CQA",
      mentionIds: ["U0AHN"],
      screenMap: () => "",
      saveCandidate: () => undefined,
      runFlow: async (flow) => (ran.push(flow.id), { status: "passed", note: "통과", runId: "r" }),
      pendingStore: store,
      log: () => undefined,
    });
    await handler.resume();
    assert.deepEqual(ran, ["qa-report-9501"]);
    assert.match(replies[0], /^950\.1 :arrows_counterclockwise: 확인하는 중에 디바이스팜 서버가 다시 켜졌어요/);
    // 이어서 처리한 것은 지우고, 되물어 둔 것(처리 중 아님)은 남긴다
    assert.equal(store.get("950.1"), undefined);
    assert.equal(store.get("960.1")?.text, "되물어 둔 것");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// 되묻기는 maxAskRounds(2)번까지. 그다음엔 더 묻지 말라고 하고, 그래도 ask면 못 만들었다고 답한다
{
  const t = setup('{"ask":"더 알려 주세요"}');
  await t.handle({ channel: "CQA", text: "<@U0AHN> 안 돼요", ts: "700.1" });
  await t.handle({ channel: "CQA", text: "그냥 안 돼요", ts: "700.2", threadTs: "700.1" });
  await t.handle({ channel: "CQA", text: "몰라요", ts: "700.3", threadTs: "700.1" });
  assert.match(t.prompts.at(-1) ?? "", /더 묻지 말고/);
  assert.equal(t.replies.filter((reply) => reply.text.startsWith(":question:")).length, 2);
  assert.match(t.replies.at(-1)?.text ?? "", /^:memo: 기기 점검 플로우로 바꾸지 않았어요/);
}

// 점검 뒤 결과가 애매하면 의견 다음에 되묻는다
{
  const t = setup(flowAnswer, '{"opinion":"등록 화면은 열렸어요.","ask":"등록하기를 누른 뒤 어떤 문구가 떴나요?"}');
  await t.handle({ channel: "CQA", text: "<@U0AHN> 등록이 이상해요", ts: "800.1" });
  assert.match(t.replies.at(-1)?.text ?? "", /^:question: 등록하기를 누른 뒤/);
  assert.match(t.replies.find((reply) => reply.text.includes("점검 결과"))?.text ?? "", /:speech_balloon: 등록 화면은 열렸어요\./);
}

// 이미지를 붙이면 받아서 플로우 만들기·의견 둘 다 그 이미지를 보게 한다
{
  const t = setup(flowAnswer);
  await t.handle({ channel: "CQA", text: "<@U0AHN> 화면 보세요", ts: "150.1", images: [{ name: "a.png", mimetype: "image/png", url: "https://files.slack.com/a" }] });
  assert.equal(t.prompts.length, 2);
  for (const prompt of t.prompts) assert.match(prompt, /qa-reports\/1\.png/);
}

// 스레드 안 답글에서 태그하면 그 스레드에 단다
{
  const t = setup(flowAnswer);
  await t.handle({ channel: "CQA", text: "<@U0AHN> 이것도", ts: "200.2", threadTs: "200.0" });
  assert.equal(t.replies[0].thread, "200.0");
}

// 다른 채널·태그 없는 글은 건드리지 않는다
{
  const t = setup(flowAnswer);
  await t.handle({ channel: "COTHER", text: "<@U0AHN> 제보", ts: "300.1" });
  await t.handle({ channel: "CQA", text: "그냥 잡담", ts: "300.2" });
  assert.equal(t.asked(), 0);
  assert.equal(t.replies.length, 0);
}

// 플로우로 못 바꾸면(skip·Claude 오류) 이유만 답하고 돌리지 않는다
{
  const skip = setup('{"skip":"질문이라 점검할 동작이 없음"}');
  await skip.handle({ channel: "CQA", text: "<@U0AHN> 이거 언제 배포돼요?", ts: "400.1" });
  assert.deepEqual(skip.ran, []);
  assert.deepEqual(skip.buttons, []);
  assert.match(skip.replies[1].text, /바꾸지 않았어요: 질문이라/);
  const broken = setup(new Error("Claude 응답이 5분 안에 오지 않았습니다."));
  await broken.handle({ channel: "CQA", text: "<@U0AHN> 화면 깨짐", ts: "400.2" });
  assert.deepEqual(broken.ran, []);
  assert.match(broken.replies[1].text, /바꾸지 못했어요: Claude 응답이/);
}

// 남의 글 스레드 댓글에서 태그하면 원글(사이 댓글·이미지)을 제보 본문으로 읽는다. 봇 글·뒤 댓글은 뺀다
{
  const t = setup(flowAnswer, undefined, [
    { type: "message", ts: "500.1", user: "U0QA", text: "자체 광고 X표시가 안 눌러진다고 함", files: [{ name: "x.png", mimetype: "image/png", url_private: "https://files.slack.com/x.png" }] },
    { type: "message", ts: "500.2", user: "U0QA2", text: "혜택 홈 배너요" },
    { type: "message", ts: "500.3", bot_id: "B1", text: "봇 글" },
    { type: "message", ts: "500.4", user: "U0AHN2", text: "<@U0AHN> 확인 부탁해요" },
    { type: "message", ts: "500.5", user: "U0QA", text: "뒤에 단 댓글" },
  ]);
  await t.handle({ channel: "CQA", text: "<@U0AHN> 확인 부탁해요", ts: "500.4", threadTs: "500.1" });
  const made = t.prompts.find((prompt) => prompt.includes("자체 광고")) ?? "";
  assert.match(made, /자체 광고 X표시가 안 눌러진다고 함[\s\S]*\[스레드 댓글\] 혜택 홈 배너요[\s\S]*\[추가 설명\] @사람 확인 부탁해요/);
  assert.doesNotMatch(made, /봇 글|뒤에 단 댓글/);
  assert.match(made, /qa-reports\/1\.png/, "원글 이미지도 본다");
  assert.equal(t.replies[0].thread, "500.1");
}
// 되물은 스레드의 답은 원글을 다시 읽지 않는다(이미 모은 제보에 추가 설명으로)
{
  const t = setup(['{"ask":"어디서요?"}', flowAnswer], undefined, []);
  await t.handle({ channel: "CQA", text: "<@U0AHN> 배너 안 눌림", ts: "600.1" });
  await t.handle({ channel: "CQA", text: "혜택 홈이요", ts: "600.2", threadTs: "600.1" });
  assert.match(t.prompts.at(-2) ?? t.prompts.at(-1) ?? "", /배너 안 눌림[\s\S]*\[추가 설명\] 혜택 홈이요/);
}

// 「멈춰」: 처리 중이면 돌던 점검을 멈추고, 그 뒤 결과·모아 둔 답으로 다시 돌리지 않는다
{
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const replies: string[] = [];
  let stops = 0;
  const runs: string[] = [];
  const handle = createQaReportHandler({
    app: sampleApp,
    client: { reply: async (_c, _t, text) => void replies.push(text.split("\n")[0]), uploadImage: async () => undefined },
    ask: async (prompt) => (prompt.includes("의견을") ? '{"opinion":"o","verdict":"unclear","appBug":false}' : flowAnswer),
    channel: "CQA",
    mentionIds: ["U0AHN"],
    screenMap: () => "",
    saveCandidate: () => undefined,
    runFlow: async (flow) => {
      runs.push(flow.id);
      await gate;
      return { status: "unsure", note: "멈춤", runId: "r9" };
    },
    stopReport: () => void (stops += 1),
    log: () => undefined,
  });
  const first = handle({ channel: "CQA", text: "<@U0AHN> 리뷰 버튼 안 보여요", ts: "700.1" });
  await new Promise((resolve) => setTimeout(resolve, 20));
  await handle({ channel: "CQA", text: "정책서에는 뭐라 되어있는데", ts: "700.2", threadTs: "700.1" });
  await handle({ channel: "CQA", text: "야야 멈춰", ts: "700.3", threadTs: "700.1" });
  release();
  await first;
  assert.equal(stops, 1);
  assert.deepEqual(runs, ["qa-report-7001"], "모아 둔 답으로 다시 돌리지 않는다");
  assert.ok(replies.some((text) => text.startsWith(":octagonal_sign: 멈췄어요")));
  assert.ok(!replies.some((text) => text.includes("점검 결과")), "멈춘 뒤 결과를 달지 않는다");
}

rmSync(shotDir, { recursive: true, force: true });
console.log("qa-report handler ok");

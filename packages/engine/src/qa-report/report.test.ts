import assert from "node:assert/strict";

import { sampleApp } from "@device-farm/core/config/sample-app";

import { isStopRequest, policyRulesText, askReply, mentionsTarget, retryPrompt, opinionPrompt, parseOpinion, parseReportFlow, plainReport, qaReportPrd, reportFlowId, reportPrompt, resultReply, stepsSummary } from "./report";

const app = { ...sampleApp, qaReport: { promptRules: ["dev 앱은 출석체크에서 광고를 띄우지 않고 바로 보상한다"], opinionRules: ["dev에서 출석체크 광고가 안 뜨는 것은 정상이다"] } };
const forbidden = app.guard.forbiddenClickNames;

// 정한 사람·그룹 태그만 제보로 본다(지금은 사람 한 명). 목록이 비면 아무것도 받지 않는다
assert.equal(mentionsTarget("<@U0AHN> 혜택에서 친구 초대 누르면 흰 화면", ["U0AHN"]), true);
assert.equal(mentionsTarget("<@U0AHN|담당자> 확인 부탁", ["U0AHN"]), true);
assert.equal(mentionsTarget("<@U0OTHER> 확인 부탁", ["U0AHN"]), false);
assert.equal(mentionsTarget("<!subteam^S01DEV> 그룹 태그", ["U0AHN"]), false);
assert.equal(mentionsTarget("<!subteam^S01DEV|@dev> 그룹도 id를 넣으면 받는다", ["U0AHN", "S01DEV"]), true);
assert.equal(mentionsTarget("@담당자 글자만 쓴 것", ["U0AHN"]), false);
assert.equal(mentionsTarget("<@U0AHN> 목록이 비면", []), false);

// 슬랙 표기를 읽는 글자로
assert.equal(plainReport("<!subteam^S01DEV|@dev> <@U1> <https://a.b/c|링크> &lt;버튼&gt;"), "@dev @사람 링크 (https://a.b/c) <버튼>");

// 프롬프트에 제보와 화면 지도가 들어간다
const prompt = reportPrompt("충전 취소하면 토스트가 안 떠요", { app, screenMap: "- /my: 「충전하기」→/charge" });
assert.match(prompt, /토스트가 안 떠요/);
assert.match(prompt, /「충전하기」/);
// 「안 됨」은 끝까지 해 보게 하고, 같은 동작의 확정 플로우 스텝을 보여 준다
{
  const withFlows = reportPrompt("상품 등록이 안 돼요", { app, knownFlows: [{ name: "내 상품 등록하고 삭제하기", steps: [{ type: "fill", label: "중량", value: "3.75" }] }] });
  assert.match(withFlows, /끝까지 해 본다/);
  assert.match(withFlows, /내 상품 등록하고 삭제하기: \[\{"type":"fill","label":"중량","value":"3\.75"\}\]/);
  assert.match(reportPrompt("x", { app }), /\[확정 플로우[^\]]*\]\n\(없음\)/);
  // 확정 플로우를 가져다 써도 추가 설명이 짚은 지점(토스트)은 확인하게 하고, 앱 코드가 있으면 거기서 문구를 찾게 한다
  assert.match(withFlows, /\[추가 설명\]\)가 짚은 지점은 반드시 확인/);
  assert.doesNotMatch(withFlows, /앱 코드 /);
  assert.match(reportPrompt("x", { app, frontDir: "/front" }), /앱 코드 \/front 에서 Grep으로 찾아/);
}

const message = { channel: "C1", text: "<!subteam^S01DEV> 친구 초대 화면이 안 열려요", ts: "1732345678.123456" };

// 플로우로: 후보(generated)·한 번만(retry false)·출처는 슬랙 QA 제보
{
  const answer = 'json 앞말 {"name":"친구 초대 열기","steps":[{"type":"click","target":{"role":"link","name":"혜택"}},{"type":"expectText","text":"나의 초대 코드"}]} 뒷말';
  const parsed = parseReportFlow(answer, message, forbidden);
  assert.ok(parsed.ok);
  assert.equal(parsed.flow.id, reportFlowId(message.ts));
  assert.equal(parsed.flow.id, "qa-report-1732345678123456");
  assert.equal(parsed.flow.name, "QA 제보 — 친구 초대 열기");
  assert.equal(parsed.flow.status, "generated");
  assert.equal(parsed.flow.prd, qaReportPrd);
  assert.equal(parsed.flow.retry, false);
  assert.equal(parsed.flow.requirement, "@그룹 친구 초대 화면이 안 열려요");
  assert.equal(stepsSummary(parsed.flow.steps), "1. 누르기 「혜택」\n2. 문구 확인 「나의 초대 코드」");
}

// 정보가 모자라면 되물을 질문
assert.deepEqual(parseReportFlow('{"ask":"어느 단계에서 막히나요?"}', message, forbidden), { ok: false, reason: "정보가 더 필요함", ask: "어느 단계에서 막히나요?" });
assert.match(reportPrompt("x", { app }), /"ask"/);
assert.match(reportPrompt("x", { app, canAsk: false }), /더 묻지 말고/);
assert.doesNotMatch(reportPrompt("x", { app, canAsk: false }), /\{"ask"/);
// 의견: JSON이면 의견·질문, 아니면 글 전체가 의견
assert.deepEqual(parseOpinion('{"opinion":"재현돼요.\\n고쳐야 해요.","ask":"언제부터요?"}'), { opinion: "재현돼요. 고쳐야 해요.", ask: "언제부터요?" });
assert.deepEqual(parseOpinion("그냥 글"), { opinion: "그냥 글" });
assert.match(askReply("어디서요?"), /^:question: 어디서요\?\n.*태그 없이도/);

// 못 바꾸는 경우: skip 이유, JSON 아님, 기대 문구 없음, 금지 버튼
assert.deepEqual(parseReportFlow('{"skip":"질문이라 점검할 동작이 없음"}', message, forbidden), { ok: false, reason: "질문이라 점검할 동작이 없음" });
assert.equal(parseReportFlow("모르겠어요", message, forbidden).ok, false);
assert.deepEqual(parseReportFlow('{"steps":[{"type":"click","target":{"role":"link","name":"혜택"}}]}', message, forbidden), { ok: false, reason: "기대 문구가 없습니다.", invalid: true });
assert.equal(parseReportFlow('{"steps":[{"type":"click","target":{"role":"button","name":"결제하기"}},{"type":"expectText","text":"완료"}]}', message, forbidden).ok, false);

// 답글: 실패·통과·못 함을 가르고, 의견이 있으면 붙인다
assert.match(resultReply({ status: "failed", note: "플로우 1개 중 1개 실패: 2단계", runId: "r1" }), /^:x: \*점검 결과: 실패\*/);
assert.match(resultReply({ status: "passed", note: "플로우 1개 통과", runId: "r1" }), /^:white_check_mark: \*점검 결과: 재현 안 됨\*/);
// 의견 판정: 재현됨 / 흐름이 못 감(unclear) / 실패했지만 다른 곳(not_reproduced)
assert.match(resultReply({ status: "failed", note: "x", runId: "r1" }, { opinion: "o", verdict: "reproduced" }), /^:x: \*점검 결과: 재현됨\*/);
assert.match(resultReply({ status: "failed", note: "x", runId: "r1" }, { opinion: "o", verdict: "unclear" }), /^:grey_question: \*점검 결과: 확인 못 함\* — 점검이 제보한 상황까지/);
assert.match(resultReply({ status: "failed", note: "x", runId: "r1" }, { opinion: "o", verdict: "not_reproduced" }), /^:grey_question: .*다른 곳에서 멈췄어요/);
assert.deepEqual(parseOpinion('{"opinion":"o","verdict":"unclear","appBug":false}'), { opinion: "o", verdict: "unclear", appBug: false });
assert.deepEqual(parseReportFlow('{"reply":""}', message, forbidden), { ok: false, reason: "다시 돌릴 필요 없음", reply: "" });
// 앱 다시 켜기 스텝과 기기에서 본 팝업 버튼을 프롬프트에 준다
assert.match(reportPrompt("x", { app, knownPopups: ["스와이프하여 다른 공지를 확인할 수 있습니다. · /category · 버튼: 이벤트 배너 · 닫기"] }), /\{"type":"relaunch"\}[\s\S]*이벤트 배너/);
assert.match(resultReply({ status: "unsure", note: "점검 못 함", runId: "r1" }), /확인하지 못했어요[\s\S]*`r1`/);
assert.match(resultReply({ status: "failed", note: "x", runId: "r1" }, "앱을 고쳐야 해요."), /:speech_balloon: 앱을 고쳐야 해요\./);
assert.doesNotMatch(resultReply({ status: "failed", note: "x", runId: "r1" }), /speech_balloon/);

// 의견 프롬프트: 제보·흐름·결과, 스크린샷이 있으면 그 경로
{
  const parsed = parseReportFlow('{"name":"n","steps":[{"type":"click","target":{"role":"link","name":"혜택"}},{"type":"expectText","text":"나의 초대 코드"}]}', message, forbidden);
  assert.ok(parsed.ok);
  const asked = opinionPrompt(app, "초대 코드가 안 보여요", parsed.flow, { status: "failed", note: "2단계 실패", runId: "r1", screenshot: "/tmp/s.png" });
  assert.match(asked, /비개발|개발자가 아닌/);
  assert.match(asked, /초대 코드가 안 보여요[\s\S]*1\. 누르기 「혜택」[\s\S]*실패 · 2단계 실패[\s\S]*\/tmp\/s\.png/);
}

// 거절되면 이유를 붙여 다시 묻는다
assert.match(retryPrompt('{"steps":[]}', "신청·결제·탈퇴·본인인증 버튼은 쓸 수 없습니다."), /\[앞 답이 거절됨\][\s\S]*거절 이유: 신청·결제·탈퇴[\s\S]*다른 길/);
// 들어가기만 하는 버튼은 눌러도 되고, 「안 보임·누락」은 정책·피그마 대조(design)로 본다
assert.match(reportPrompt("x", { app }), /\{"type":"design"\} — 지금 화면을 정책서 규칙과 피그마/);
// 광고 스텝 뒤에 문구 확인이 있으면 잔액 대신 그 문구로 본다(출석체크 화면엔 잔액이 없다)
{
  const attendance = parseReportFlow('{"name":"출석","steps":[{"type":"click","target":{"role":"link","name":"혜택"}},{"type":"watchAd","target":{"role":"button","name":"출석체크 하기"}},{"type":"expectText","text":"오늘의 출석을 완료했어요"}]}', message, forbidden);
  assert.ok(attendance.ok);
  assert.deepEqual(attendance.flow.steps[1], { type: "watchAd", target: { role: "button", name: "출석체크 하기" }, reward: "screen" });
  // 뒤에 문구 확인이 없으면(모으기) 잔액으로 본다
  const mining = parseReportFlow('{"name":"담기","steps":[{"type":"click","target":{"role":"link","name":"혜택"}},{"type":"watchAd","target":{"role":"button","name":"모으기","match":"prefix"}}]}', message, forbidden);
  assert.ok(mining.ok);
  assert.equal(mining.flow.steps[1].type === "watchAd" && mining.flow.steps[1].reward, undefined);
  assert.match(reportPrompt("x", { app }), /"type":"watchAd"[\s\S]*"reward":"screen"/);
}
// dev 출석체크는 광고 없이 바로 보상한다 — 만들 때도 의견 쓸 때도 안다
assert.match(reportPrompt("x", { app }), /dev 앱은 출석체크에서 광고를 띄우지 않고/);
{
  const parsed = parseReportFlow('{"name":"n","steps":[{"type":"click","target":{"role":"link","name":"혜택"}},{"type":"expectText","text":"출석"}]}', message, forbidden);
  assert.ok(parsed.ok);
  assert.match(opinionPrompt(app, "출석체크가 안 돼요", parsed.flow, { status: "passed", note: "통과", runId: "r1" }), /dev에서 출석체크 광고가 안 뜨는 것은 정상이다/);
}
// 시간 제한 화면에는 fast를 쓰게 하고, 하단 탭은 앱 설정에서 온다
assert.match(reportPrompt("x", { app }), /시간 제한이 짧은 화면[\s\S]*"fast":true/);
assert.match(reportPrompt("x", { app }), /Sample Shop 앱[\s\S]*하단 탭은 link 「홈」「카테고리」「혜택」「마이」/);
// 「멈춰」류 짧은 답만 멈춤으로 본다
assert.equal(isStopRequest("야야 멈춰"), true);
assert.equal(isStopRequest("그만"), true);
assert.equal(isStopRequest("<@U0AHN> 중지"), true);
assert.equal(isStopRequest("결제 취소하면 토스트가 안 떠요. 확인해 주세요"), false);
// 정책을 묻는 답은 기기를 다시 돌리지 않고 정책서 규칙으로 답한다
assert.match(reportPrompt("x", { app }), /정책·기준·이유를 묻는 질문[\s\S]*기기를 다시 돌리지 말고/);
assert.match(reportPrompt("x", { app, policyDir: "/farm/policy" }), /\/farm\/policy\/policy-rules\.md/);
assert.doesNotMatch(reportPrompt("x", { app }), /policy-rules\.md/);
assert.equal(
  policyRulesText([{ pageTitle: "쇼핑 리뷰/컨텐츠 통합 정책", rules: [{ section: "5. 외부 컨텐츠", statement: "게시물 최소 유지 기간은 6개월이다", evidence: "최소 6개월간 유지" }] }]),
  "## 쇼핑 리뷰/컨텐츠 통합 정책\n- [5. 외부 컨텐츠] 게시물 최소 유지 기간은 6개월이다 (근거: 최소 6개월간 유지)",
);
console.log("qa-report ok");

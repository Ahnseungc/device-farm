import assert from "node:assert/strict";

import { compareCopyRules, diffFigmaCopy, docsMismatchChecks, figmaChecks, hasBugCandidate, isIgnored, screenTextHash } from "./compare";
import { judgeKey, parseVerdicts, verdictChecks } from "./judge";
import { buildPageRules, classifyFinding, classifyWithFigma, parseExtraction, rejectReason, screenMatches, storageToText, type PolicyRule, type RuleCandidate } from "./rules";

const body = storageToText(
  "<h2>고객 안내 문구 모음</h2><p>포인트는&nbsp;10,000원 이상부터<br/>출금할 수 있어요.</p><table><tr><td>6회차부터</td><td>수수료 1,000원</td></tr></table>",
);
assert.ok(body.includes("포인트는 10,000원 이상부터\n출금할 수 있어요."));
assert.ok(body.includes("6회차부터 | 수수료 1,000원"));

const copy: RuleCandidate = {
  kind: "copy",
  section: "고객 안내 문구 모음",
  statement: "최소 출금 금액 안내",
  expected: "포인트는 10,000원 이상부터 출금할 수 있어요.",
  evidence: "포인트는 10,000원 이상부터 출금할 수 있어요.",
  screens: ["/my/withdraw"],
  visibleOnOpen: true,
};
// 줄바꿈·공백이 달라도 근거로 인정한다
assert.equal(rejectReason(copy, body), null);
// 지어낸 근거는 버린다
assert.equal(rejectReason({ ...copy, evidence: "포인트는 5,000원 이상부터 출금할 수 있어요." }, body), "근거 인용이 정책 본문에 없습니다.");
// 값 규칙은 값이 근거에 있어야 한다
const value: RuleCandidate = { ...copy, kind: "value", statement: "6회차부터 수수료", expected: "2,000원", evidence: "6회차부터 | 수수료 1,000원" };
assert.match(rejectReason(value, body) ?? "", /2,000/);
assert.equal(rejectReason({ ...value, expected: "1,000원" }, body), null);

// 경로 패턴
assert.equal(screenMatches("/my/withdraw/*", "/my/withdraw/123?x=1"), true);
assert.equal(screenMatches("/my/withdraw/*", "/my/withdraw"), false);

// 응답 해석: 펜스·설명이 붙어도, 모양이 틀린 규칙은 건너뛴다
const parsed = parseExtraction('설명\n```json\n{"screens":["/a"],"rules":[{"kind":"copy","statement":"s","evidence":"e","screens":["/a"],"visibleOnOpen":true},{"kind":"x"}]}\n```');
assert.deepEqual(parsed.screens, ["/a"]);
assert.equal(parsed.candidates.length, 1);

// 다시 뽑아도 같은 규칙은 처음 생긴 시각을 잇고, 사라진 근거의 규칙은 없어진다
const page = { id: "1", title: "포인트 출금 통합 정책", hash: "h1", modifiedAt: "2026-09-01T00:00:00.000Z" };
const first = buildPageRules(page, body, [copy, { ...copy, evidence: "없는 문장" }], []);
assert.equal(first.rules.length, 1);
assert.equal(first.dropped.length, 1);
const second = buildPageRules({ ...page, hash: "h2", modifiedAt: "2026-11-10T00:00:00.000Z" }, body, [copy, { ...value, expected: "1,000원" }], first.rules);
assert.equal(second.rules.find((rule) => rule.kind === "copy")?.since, "2026-09-01T00:00:00.000Z");
assert.equal(second.rules.find((rule) => rule.kind === "value")?.since, "2026-11-10T00:00:00.000Z");

// 분류: 14일 안이면 앱 반영 전, 화면이 바뀌었으면 문서 갱신 누락, 아니면 버그 후보
const now = Date.parse("2026-11-11T00:00:00.000Z");
assert.equal(classifyFinding({ since: "2026-11-01T00:00:00.000Z" }, false, now), "pending-app");
assert.equal(classifyFinding({ since: "2026-09-01T00:00:00.000Z" }, true, now), "app-changed");
assert.equal(classifyFinding({ since: "2026-09-01T00:00:00.000Z" }, false, now), "bug-candidate");

// 화면 문구 비교
const [oldRule] = first.rules;
const newRule: PolicyRule = second.rules.find((rule) => rule.kind === "value")!;
const context = { path: "/my/withdraw", ignores: [], screenChanged: false, now };
const passed = compareCopyRules([oldRule], { ...context, text: "포인트는 10,000원 이상부터\n출금할 수 있어요." });
assert.equal(passed[0].ok, true);
const missing = compareCopyRules([oldRule, newRule], { ...context, text: "출금하기" });
assert.equal(missing.find((check) => check.id === oldRule.id)?.finding, "bug-candidate");
assert.equal(missing.find((check) => check.id === newRule.id)?.finding, "pending-app");
assert.equal(hasBugCandidate(missing), true);
// 무시는 그때의 정책 해시에 묶인다
const ignores = [{ key: oldRule.id, hash: oldRule.pageHash, reason: "토스트 문구", at: "" }];
assert.equal(hasBugCandidate(compareCopyRules([oldRule], { ...context, ignores, text: "출금하기" })), false);
assert.equal(isIgnored(ignores, oldRule.id, "다른 해시"), false);
// 상황 문구는 열자마자 확인하지 않는다
assert.equal(compareCopyRules([{ ...oldRule, visibleOnOpen: false }], { ...context, text: "" }).length, 0);

// 화면 해시는 숫자를 지워 시세가 바뀌어도 같다
assert.equal(screenTextHash("총 1,000원"), screenTextHash("총  2,345원"));

// 피그마 문구 차이: 숫자가 든 글자는 고정 문구가 아니라 빼고 본다
const diff = diffFigmaCopy(["출금하기", "출금 가능 금액", "12,000원"], "출금하기\n보유 포인트\n3,000원");
assert.deepEqual(diff, { missingOnScreen: ["출금 가능 금액"], notInFigma: ["보유 포인트"] });
assert.equal(figmaChecks(diff, "f1", "/a", []).length, 1);
// 정책·앱엔 있는데 피그마에 없으면 피그마 쪽이 뒤처짐. 앱에도 없으면 여기서는 보지 않는다(문구 규칙 쪽 삼자 분류)
const onScreen = "포인트는 10,000원 이상부터 출금할 수 있어요.";
assert.equal(docsMismatchChecks([oldRule], ["출금하기"], onScreen, [])[0].finding, "docs-mismatch");
assert.equal(docsMismatchChecks([oldRule], ["출금하기"], "출금하기", []).length, 0);
assert.equal(docsMismatchChecks([oldRule], [], onScreen, []).length, 0);

// 정책·피그마·앱 삼자: 피그마가 정책 편이면 앱 버그, 아니면 정책 문서가 뒤처짐
const withFigma = (figmaTexts: string[]) => compareCopyRules([oldRule], { ...context, text: "출금하기", figmaTexts })[0];
assert.equal(withFigma([onScreen]).finding, "bug-candidate");
assert.equal(withFigma(["출금하기", "월 5회 출금 수수료 무료"]).finding, "policy-outdated");
assert.match(withFigma(["출금하기"]).message ?? "", /피그마에도 없습니다/);
assert.equal(hasBugCandidate([withFigma(["출금하기"])]), false);
assert.equal(classifyWithFigma({ since: "2026-11-01T00:00:00.000Z" }, true, false, now), "pending-app");

// 판정: 모르는 규칙 id는 버리고, 판단 불가는 통과로 둔다
const behavior: PolicyRule = { ...oldRule, id: "b1", kind: "behavior", statement: "PROCESSING이면 취소 버튼 미노출" };
const verdicts = parseVerdicts('{"verdicts":[{"ruleId":"b1","result":"differ","reason":"취소 버튼이 보입니다","figma":"bogus"},{"ruleId":"zz","result":"match"}]}', [behavior]);
assert.equal(verdicts[0].figma, "unknown");
// 피그마가 앱과 같으면 정책 문서가 뒤처짐
assert.equal(verdictChecks([behavior], [{ ...verdicts[0], figma: "app" }], { ignores: [], screenChanged: false, now })[0].finding, "policy-outdated");
assert.equal(verdicts.length, 1);
assert.equal(verdictChecks([behavior], verdicts, { ignores: [], screenChanged: false, now })[0].finding, "bug-candidate");
assert.equal(verdictChecks([behavior], [{ ruleId: "b1", result: "unknown", reason: "" }], { ignores: [], screenChanged: false, now })[0].ok, true);
assert.notEqual(judgeKey("/a", "s1", [behavior], ""), judgeKey("/a", "s2", [behavior], ""));

console.log("policy rules ok");

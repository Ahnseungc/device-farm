import assert from "node:assert/strict";

import { compareCopyRules, diffFigmaCopy, docsMismatchChecks, figmaChecks, figmaCoverage, hasBugCandidate, isCheckableCopy, isIgnored, normalizeCopy, screenTextHash } from "./compare";
import { judgeKey, judgePrompt, meaningChecks, parseVerdicts, sameMeaningLabel, verdictChecks } from "./judge";
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
// 객체 뒤에 다른 객체가 붙어도 첫 객체를 읽는다. 문자열 안의 괄호는 세지 않는다
assert.deepEqual(parseExtraction('{"screens":["/a}"],"rules":[]}\n\n확인: {"screens":["/b"]}').screens, ["/a}"]);
assert.throws(() => parseExtraction('{"screens":["/a"'));

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
const figmaTexts = ["포인트는 10,000원 이상부터 출금할 수 있어요."];
const missing = compareCopyRules([oldRule, newRule], { ...context, text: "출금하기", figmaTexts });
assert.equal(missing.find((check) => check.id === oldRule.id)?.finding, "bug-candidate");
// 「1,000원」처럼 숫자·단위뿐인 문구는 화면 어디에 있어도 맞아 글자로 확인하지 않는다
assert.equal(missing.find((check) => check.id === newRule.id), undefined);
assert.equal(hasBugCandidate(missing), true);
// 피그마로 확인하지 못하면 버그 후보라고 단정하지 않는다
assert.equal(compareCopyRules([oldRule], { ...context, text: "출금하기" })[0].finding, "unverified");
// 무시는 그때의 정책 해시에 묶인다
const ignores = [{ key: oldRule.id, hash: oldRule.pageHash, reason: "토스트 문구", at: "" }];
assert.equal(hasBugCandidate(compareCopyRules([oldRule], { ...context, ignores, text: "출금하기", figmaTexts })), false);
// 표기만 다른 것은 같게 본다: 숫자 뒤 이상·이하, 물결표, 문장부호, 공백
assert.equal(normalizeCopy("0g 이상 ~ 0.1g 미만"), normalizeCopy("0g ~ 0.1g 미만"));
assert.equal(normalizeCopy("「광고 보고 포인트 받기」"), normalizeCopy("광고 보고 포인트 받기"));
assert.notEqual(normalizeCopy("24시간 이내"), normalizeCopy("48시간 이내"));
assert.equal(isCheckableCopy("5회"), false);
assert.equal(isCheckableCopy("0.00001g"), false);
assert.equal(isCheckableCopy("모은 포인트 0.5g"), true);
assert.equal(isCheckableCopy("공유하기"), true);
assert.equal(isIgnored(ignores, oldRule.id, "다른 해시"), false);
// 상황 문구는 열자마자 확인하지 않는다
assert.equal(compareCopyRules([{ ...oldRule, visibleOnOpen: false }], { ...context, text: "" }).length, 0);

// 화면 해시는 숫자를 지워 시세가 바뀌어도 같다
assert.equal(screenTextHash("총 1,000원"), screenTextHash("총  2,345원"));

// 피그마 문구 차이: 숫자가 든 글자는 고정 문구가 아니라 빼고 본다
const diff = diffFigmaCopy(["출금하기", "출금 가능 금액", "12,000원"], "출금하기\n보유 포인트\n3,000원");
assert.deepEqual(diff, { missingOnScreen: ["출금 가능 금액"], notInFigma: ["보유 포인트"] });
assert.equal(figmaChecks(diff, "f1", "/a", []).length, 1);
// 「문제 아님」으로 무시한 피그마 차이는 피그마 페이지 해시가 바뀌어도 다시 알리지 않는다.
// 무시하지 않은 새 문구는 그대로 잡는다
const menuDiff = diffFigmaCopy(["메뉴"], "메뉴\n개발용 (dev 에서만 보임)\n담당자님, 반가워요!\n새로 생긴 문구");
const menuIgnores = ["개발용(dev에서만보임)", "담당자님,반가워요!"].map((text) => ({ key: `figma:/menu:extra:${text}`, hash: "2cf52ff8", reason: "문제 아님", at: "2026-11-20T06:23:47.294Z" }));
const menuChecks = figmaChecks(menuDiff, "새 페이지 해시", "/menu", menuIgnores);
assert.deepEqual(menuChecks.filter((check) => !check.ignored).map((check) => check.title), ["피그마 문구 「새로 생긴 문구」"]);
assert.equal(menuChecks.find((check) => check.ignored)?.ignoreHash, "새 페이지 해시");
// 다른 화면에서 무시한 같은 문구는 이 화면 무시가 아니다
assert.equal(figmaChecks(menuDiff, "새 페이지 해시", "/my", menuIgnores).filter((check) => check.ignored).length, 0);
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
// 피그마로 알 수 없으면 확인 필요, 피그마가 정책 편이면 버그 후보
assert.equal(verdictChecks([behavior], verdicts, { ignores: [], screenChanged: false, now })[0].finding, "unverified");
assert.equal(verdictChecks([behavior], [{ ...verdicts[0], figma: "policy" }], { ignores: [], screenChanged: false, now })[0].finding, "bug-candidate");
assert.equal(verdictChecks([behavior], [{ ruleId: "b1", result: "unknown", reason: "" }], { ignores: [], screenChanged: false, now })[0].ok, true);
assert.notEqual(judgeKey("/a", "s1", [behavior], ""), judgeKey("/a", "s2", [behavior], ""));

// 문구 뜻 비교: 글자로 어긋난 문구 규칙만 판정에 붙이고, 같은 뜻이면 통과로 바꾼다
const literal = compareCopyRules([oldRule], { ...context, text: "1만원부터 출금 가능", figmaTexts: ["출금하기"] });
assert.equal(literal[0].finding, "policy-outdated");
assert.match(judgePrompt("/a", "1만원부터 출금 가능", [behavior, oldRule], null), /\[문구\] 「포인트는 10,000원 이상부터 출금할 수 있어요\.」와 같은 뜻/);
assert.doesNotMatch(judgePrompt("/a", "", [behavior], null), /\[문구\] 규칙은/);
const same = meaningChecks(literal, [{ ruleId: oldRule.id, result: "match", reason: "「1만원부터 출금 가능」" }]);
assert.equal(same[0].ok, true);
assert.equal(same[0].finding, undefined);
assert.equal(same[0].message, `${sameMeaningLabel}: 「1만원부터 출금 가능」`);
// 다름·판단 불가·판정 없음은 글자 비교 결과 그대로
assert.deepEqual(meaningChecks(literal, [{ ruleId: oldRule.id, result: "differ", reason: "기준 금액이 다름" }]), literal);
assert.deepEqual(meaningChecks(literal, [{ ruleId: oldRule.id, result: "unknown", reason: "" }]), literal);
assert.deepEqual(meaningChecks(literal, []), literal);
// 문구 규칙이 판정에 붙으면 캐시 키가 바뀐다
assert.notEqual(judgeKey("/a", "s1", [behavior], ""), judgeKey("/a", "s1", [behavior, oldRule], ""));

console.log("policy rules ok");

// 화면 고정 문구 중 피그마에 있는 비율 — 다른 화면 디자인이면 낮다
assert.equal(figmaCoverage(["출금하기", "보유 포인트"], "출금하기\n보유 포인트\n3,000원"), 1);
assert.equal(figmaCoverage(["스플래시", "한가위 혜택 시작"], "적립/사용\n포인트\n출금하기"), 0);
assert.equal(figmaCoverage(["스플래시"], "3,000원"), 1);

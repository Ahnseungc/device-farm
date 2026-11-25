import assert from "node:assert/strict";

import type { FailureAlert } from "./failure-alert";
import { failureAlertBlocks } from "./failure-alert";
import { alertActionBlocks, canStartFix, farmFixLine, farmFixPrompt, parseNoFix, fixBranchName, fixPrActionId, fixPrBody, fixPrLine, fixPrompt, fixPrTitle, isNoFix } from "./fix-pr";

const alert: FailureAlert = {
  type: "failure",
  key: "failure|dev|플로우 점검 · 출석체크|출석체크 실패 #",
  path: "플로우 점검 · 출석체크",
  finding: "behavior",
  message: "출석체크 버튼을 누르지 않았습니다",
  device: "SM-A325N (android 13)",
  build: "dev 2.0.28",
  runId: "r1",
};

type Actions = { type: string; elements: { action_id: string }[] };
const actionIds = (blocks: unknown[]) => (blocks.find((block) => (block as Actions).type === "actions") as Actions | undefined)?.elements.map((element) => element.action_id) ?? [];

// 버튼: 토큰이 있을 때만, 다시 누를 수 있을 때만
assert.deepEqual(actionIds(failureAlertBlocks(alert)), ["policy_alert_done", "policy_alert_checking", "policy_alert_not_issue"]);
assert.deepEqual(actionIds(failureAlertBlocks(alert, { status: "open" }, true)).at(-1), fixPrActionId);
assert.deepEqual(actionIds(failureAlertBlocks(alert, { status: "done" }, true)), [fixPrActionId]);
assert.deepEqual(actionIds(failureAlertBlocks(alert, { status: "done", fix: { state: "running" } }, true)), []);
assert.deepEqual(alertActionBlocks(alert.key, { status: "done", fix: { state: "opened", prs: [] } }, true), []);
assert.deepEqual(actionIds(failureAlertBlocks(alert, { status: "open", fix: { state: "failed", note: "x" } }, true)).at(-1), fixPrActionId);
assert.equal(canStartFix(undefined), true);
assert.equal(canStartFix({ state: "no-change" }), true);
assert.equal(canStartFix({ state: "running" }), false);
assert.equal(canStartFix({ state: "opened" }), false);

// 상태 줄
assert.equal(fixPrLine(undefined), null);
assert.equal(fixPrLine({ state: "running", by: "U1" }), ":hammer_and_wrench: 수정 PR 만드는 중 · <@U1>");
assert.equal(
  fixPrLine({ state: "opened", prs: [{ base: "development", number: 12, url: "https://g/12" }, { base: "main", number: 13, url: "https://g/13" }] }),
  ":white_check_mark: 수정 PR: <https://g/12|development #12> · <https://g/13|main #13>",
);
assert.equal(fixPrLine({ state: "no-change" }), ":warning: 수정 PR 없음 — 고칠 곳을 못 찾았어요");
const contextTexts = failureAlertBlocks(alert, { status: "open", fix: { state: "running", by: "U1" } }, true).flatMap((block) =>
  (block as { type: string; elements?: { text?: string }[] }).type === "context" ? ((block as { elements: { text?: string }[] }).elements.map((element) => element.text ?? "")) : [],
);
assert.ok(contextTexts.some((text) => text.includes("수정 PR 만드는 중")));

// 브랜치 이름: 같은 키·시각이면 같다, 키가 다르면 다르다
const now = new Date(2026, 10, 17, 9, 5);
assert.match(fixBranchName(alert.key, now), /^farm-fix\/20261117-0905-[0-9a-f]{8}$/);
assert.equal(fixBranchName(alert.key, now), fixBranchName(alert.key, now));
assert.notEqual(fixBranchName(alert.key, now), fixBranchName(`${alert.key}x`, now));

// 프롬프트: 실패 문구·근거 폴더·NO_FIX 규칙
const prompt = fixPrompt(alert, { repo: "example/shop-web", base: "development", resultsDir: "/r/devices/r1", screenshot: "/r/s.png" });
assert.ok(prompt.includes("출석체크 버튼을 누르지 않았습니다"));
assert.ok(prompt.includes("/r/devices/r1"));
assert.ok(prompt.includes("/r/s.png"));
assert.ok(prompt.includes("NO_FIX"));
assert.equal(isNoFix("NO_FIX: 서버 오류"), true);
assert.equal(isNoFix("고쳤어요"), false);

// PR 제목·본문
assert.equal(fixPrTitle(alert, "development", "development"), "fix: 동작 오류 · 플로우 점검 · 출석체크");
assert.equal(fixPrTitle(alert, "main", "development"), "[hotfix] fix: 동작 오류 · 플로우 점검 · 출석체크");
const body = fixPrBody(alert, { summary: "원인: 버튼 가려짐", farmOrigin: "https://192.168.13.77:5173", related: [{ base: "development", number: 12, url: "https://g/12" }] });
assert.ok(body.includes("원인: 버튼 가려짐"));
assert.ok(body.includes("https://192.168.13.77:5173"));
assert.ok(body.includes("development: https://g/12"));

// NO_FIX 분류
assert.deepEqual(parseNoFix("NO_FIX farm\n광고 줄임표를 겹침으로 봤어요"), { category: "farm", reason: "광고 줄임표를 겹침으로 봤어요" });
assert.deepEqual(parseNoFix("NO_FIX server: 500"), { category: "server", reason: "500" });
assert.deepEqual(parseNoFix("NO_FIX — 근거 없음"), { category: "unsure", reason: "근거 없음" });
assert.equal(parseNoFix("고쳤어요"), null);
assert.ok(prompt.includes("NO_FIX farm"));

// 디바이스팜 고치기 줄·프롬프트
assert.equal(farmFixLine(undefined), null);
assert.equal(farmFixLine({ state: "committed", commit: "deadbeef1234" }), ":white_check_mark: 디바이스팜 오탐 — 점검 로직을 고쳐 main에 커밋했어요 `deadbee`");
assert.equal(farmFixLine({ state: "committed", commit: "cafe1234", scenario: true, recheck: { state: "passed" } }), ":white_check_mark: 디바이스팜 오탐 — 시나리오를 고쳐 main에 커밋했어요 `cafe123` · 다시 돌려 통과");
const farmContext = failureAlertBlocks(alert, { status: "open", fix: { state: "no-change", category: "farm", farm: { state: "running" } } }, true).find(
  (block) => (block as { type: string; elements?: { text?: string }[] }).type === "context" && JSON.stringify(block).includes("디바이스팜 오탐"),
);
assert.ok(farmContext);
const farmPrompt = farmFixPrompt(alert, { reason: "광고 줄임표", resultsDir: null, busyFiles: ["packages/server/src/farm.ts"] });
assert.ok(farmPrompt.includes("광고 줄임표"));
assert.ok(farmPrompt.includes("packages/server/src/farm.ts"));
assert.ok(farmPrompt.includes("진짜 버그는 계속 잡혀야 한다"));

console.log("fix-pr ok");

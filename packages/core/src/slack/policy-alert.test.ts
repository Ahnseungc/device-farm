import assert from "node:assert/strict";

import type { DeviceRun } from "../device/types";
import { figmaUrl, policyAlertBlocks, policyAlertsOf, statusOfAction, alertActionIds } from "./policy-alert";

const device = { id: "d1", platform: "android", model: "SM-A325N", osVersion: "13" } as DeviceRun["outcomes"][number]["device"];
const run: DeviceRun = {
  runId: "r1",
  kind: "dev",
  version: "2.0.28+463",
  trigger: "manual",
  startedAt: "",
  finishedAt: "2026-11-12T00:00:00Z",
  outcomes: [
    {
      device,
      status: "passed",
      screens: [
        {
          scenario: "정책 점검 · /my/withdraw",
          status: "passed",
          checks: [
            { id: "a", title: "수수료 안내 문구", ok: false, finding: "policy-outdated", message: "[정책 문서가 뒤처짐] 화면에 없어요", ignoreKey: "a", ignoreHash: "h1", pageId: "204275732" },
            { id: "b", title: "무시한 규칙", ok: false, finding: "bug-candidate", ignored: true, ignoreKey: "b", ignoreHash: "h1" },
            { id: "c", title: "피그마 문구 「국민은행」", ok: false, message: "[피그마 차이]", ignoreKey: "figma:x", ignoreHash: "f" },
            { id: "d", title: "통과", ok: true, ignoreKey: "d", ignoreHash: "h1" },
          ],
        } as never,
        { scenario: "플로우 점검 · 홈", status: "failed" },
      ],
    },
  ],
};

const alerts = policyAlertsOf(run, {
  policyPage: (id) => (id === "204275732" ? { title: "포인트 출금 통합 정책", url: "https://wiki/pages/204275732", ownerName: "안비손", ownerSlackId: "U123" } : null),
  figmaRefs: (path) => (path === "/my/withdraw" ? ["KEY:1:2", "KEY:3:4", "KEY:5:6", "KEY:7:8"] : []),
});

// 무시한 것·분류 없는 피그마 문구 차이·통과·정책 점검이 아닌 결과는 빼고 하나만
assert.equal(alerts.length, 1);
assert.equal(alerts[0].key, "/my/withdraw|a|h1");
assert.equal(alerts[0].message, "화면에 없어요");
assert.equal(alerts[0].policy?.title, "포인트 출금 통합 정책");
assert.deepEqual(alerts[0].figmaUrls, ["https://www.figma.com/design/KEY/?node-id=1-2", "https://www.figma.com/design/KEY/?node-id=3-4", "https://www.figma.com/design/KEY/?node-id=5-6"]);
assert.equal(figmaUrl("K:12:34"), "https://www.figma.com/design/K/?node-id=12-34");

// 메시지에 정책서·피그마 링크와 처리 버튼 세 개
const text = JSON.stringify(policyAlertBlocks(alerts[0]));
assert.ok(text.includes("<https://wiki/pages/204275732|정책서: 포인트 출금 통합 정책>"));
assert.ok(text.includes("피그마 1"));
assert.ok(text.includes("처리 완료") && text.includes("확인 중") && text.includes("문제 아님"));
assert.ok(text.includes("확인 필요"));
// 정책서 작성자를 태그한다. 슬랙 계정을 모르면 이름만
assert.ok(text.includes("정책서 작성자 <@U123> 확인 부탁드려요."));
assert.ok(JSON.stringify(policyAlertBlocks({ ...alerts[0], policy: { title: "t", url: "u", ownerName: "안비손" } })).includes("정책서 작성자 안비손"));
// 상태가 바뀌면 누가 언제 했는지 남는다
const doneText = JSON.stringify(policyAlertBlocks(alerts[0], { status: "done", by: "U1", at: "11/12 11:00" }));
assert.ok(doneText.includes("처리 완료* · <@U1> · 11/12 11:00"));
// 상태가 바뀌면 버튼은 사라진다
assert.ok(!doneText.includes('"type":"actions"'));
assert.ok(!JSON.stringify(policyAlertBlocks(alerts[0], { status: "checking", by: "U1" })).includes('"type":"actions"'));
assert.ok(text.includes('"type":"actions"'));

assert.equal(statusOfAction(alertActionIds.done), "done");
assert.equal(statusOfAction("other"), null);

console.log("policy alert ok");

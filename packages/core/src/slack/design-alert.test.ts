import assert from "node:assert/strict";

import type { DeviceRun } from "../device/types";

import { designAlertBlocks, designAlertOf, designDiffsOf, isUserDataText } from "./design-alert";

// 사용자·서버 데이터는 거른다
assert.equal(isUserDataText("이*환님"), true);
assert.equal(isUserDataText("홍길동님"), true);
assert.equal(isUserDataText("#앱테크, #금테크"), true);
assert.equal(isUserDataText("필수키워드: #포인트후기"), true);
assert.equal(isUserDataText("홍길동님 명의의 계좌만 등록할 수 있어요.", ["홍길동"]), true);
assert.equal(isUserDataText("레벨별 보상"), false);
assert.equal(isUserDataText("광고 보고 룰렛 돌리기"), false);

const figma = (text: string, ignored = false) => ({ id: `figma:/x:extra:${text}`, title: `피그마 문구 「${text}」`, ok: false, message: "[피그마 차이]", ignoreKey: `figma:/x:extra:${text}`, ignoreHash: "f1", ignored });
const run = {
  runId: "r1",
  kind: "dev",
  version: "설치된 앱",
  trigger: "manual",
  startedAt: "",
  finishedAt: "",
  outcomes: [
    {
      device: { id: "A", platform: "android", model: "SM-A325N", osVersion: "13", appVersion: null },
      status: "passed",
      screens: [
        { scenario: "정책 점검 · /dev/farm-sample", status: "passed", checks: [figma("레벨별 보상"), figma("이*환님"), figma("무시한 것", true), { ...figma("정책"), id: "rule-1" }] },
        { scenario: "플로우 점검 · 알림", status: "passed", checks: [figma("플로우는 안 봄")] },
      ],
    },
  ],
} as unknown as DeviceRun;

const diffs = designDiffsOf(run);
assert.deepEqual(diffs.map((diff) => [diff.path, diff.text]), [["/dev/farm-sample", "레벨별 보상"]]);

const alert = designAlertOf(run, diffs, () => ["https://www.figma.com/design/K/?node-id=1-2"]);
assert.equal(alert?.key, "design|r1");
assert.equal(designAlertOf(run, [], () => []), null);
const body = JSON.stringify(designAlertBlocks(alert!));
assert.ok(body.includes("디자인 오류 · 피그마와 다른 문구 1건"));
assert.ok(body.includes("「레벨별 보상」"));
assert.ok(body.includes("policy_alert_done"));
// 상태가 정해지면 버튼은 없다
assert.ok(!JSON.stringify(designAlertBlocks(alert!, { status: "done" })).includes("policy_alert_done"));

console.log("design alert ok");

import assert from "node:assert/strict";

import type { ChaosRun } from "../chaos/types";
import type { DeviceRun } from "../device/types";

import { buildDailyInput, dailyPrompt, dailyReportDue, dailySlackMessage, dailySlackText, isEmptyInput, parseDailyAnalysis } from "./daily";

const device = { id: "A", platform: "android", model: "SM-A325N", osVersion: "13", appVersion: "2.0.28+463" } as const;
const run: DeviceRun = {
  runId: "r1",
  kind: "dev",
  version: "설치된 앱",
  trigger: "auto",
  label: "야간 플로우 점검",
  startedAt: "2026-11-13T03:00:00Z",
  finishedAt: "2026-11-13T03:10:00Z",
  outcomes: [
    {
      device,
      status: "failed",
      screens: [
        { scenario: "플로우 점검 · 알림 열기", status: "passed" },
        { scenario: "플로우 점검 · 출석체크 열기", status: "failed", message: "2단계 누르기 「출석체크」 실패", screenshot: "devices/r1/A/x/screenshot.png" },
        { scenario: "정책 점검 · /benefit", status: "failed", checks: [
            { id: "c1", title: "참여 적립", ok: false, finding: "bug-candidate", ignoreKey: "c1", ignoreHash: "", message: "화면에 없음" },
            { id: "figma:/benefit:extra:레벨별보상", title: "피그마 문구 「레벨별 보상」", ok: false, ignoreKey: "figma:/benefit:extra:레벨별보상", ignoreHash: "f1", message: "[피그마 차이]" },
            { id: "figma:/benefit:extra:이환님", title: "피그마 문구 「이*환님」", ok: false, ignoreKey: "figma:/benefit:extra:이환님", ignoreHash: "f1", message: "[피그마 차이]" },
          ] as never,
        },
      ],
    },
  ],
};
const bot = {
  runId: "b1",
  deviceId: "A",
  seed: 20261113,
  startedAt: "2026-11-13T03:30:00Z",
  finishedAt: "2026-11-13T04:00:00Z",
  states: 30,
  blocked: [],
  steps: [1, 2, 3].map((step) => ({
    episode: 1,
    step,
    at: "",
    from: "/my",
    state: "",
    candidates: [],
    chosen: "press:button:혜택 지원금",
    chosenProbability: 0.1,
    to: "/my",
    newState: false,
    dead: false,
    errors: [{ kind: "network", message: `GET 404 https://x/a/hZMQ ${step}` }],
    warnings: [],
  })),
} as unknown as ChaosRun;

const input = buildDailyInput([run], [bot], { from: "2026-11-12T09:00:00Z", to: "2026-11-13T09:00:00Z" }, ["예전 문제"]);
// 숫자만 다른 봇 오류 3번은 하나로 묶인다
assert.equal(input.evidence.find((item) => item.id === "B1")?.count, 3);
assert.deepEqual(input.evidence.map((item) => item.id).sort(), ["B1", "D1", "P1", "R1"]);
// 피그마 차이는 화면마다 한 근거, 가린 이름은 거른다
assert.equal(input.evidence.find((item) => item.id === "D1")?.text, "[/benefit] 피그마에 없는 문구 1개: 「레벨별 보상」");
assert.equal(input.stats.designDiffs, 1);
assert.equal(input.stats.flowsPassed, 1);
assert.equal(input.stats.flows, 2);
assert.equal(input.stats.policyBugs, 1);
assert.ok(dailyPrompt(input, "/farm/test-results").includes("/farm/test-results/devices/r1/A/x/screenshot.png"));

// 근거 번호가 입력에 없는 항목은 버린다
const analysis = parseDailyAnalysis(
  'x ```json\n{"summary":"쇼핑 배너 링크 깨짐","issues":[{"title":"배너 링크","kind":"data","evidence":["B1","Z9"],"action":"관리자 확인","new":true},{"title":"근거 없음","kind":"app-bug","evidence":["Z1"],"action":"","new":true},{"title":"출석체크","kind":"flaky","evidence":["R1"],"action":"","new":false}],"stable":"알림 통과"}\n```',
  input,
);
assert.deepEqual(analysis.issues.map((issue) => [issue.title, issue.evidence]), [["배너 링크", ["B1"]], ["출석체크", ["R1"]]]);
assert.throws(() => parseDailyAnalysis("모르겠어요", input));

const text = dailySlackText(input, analysis, "11/13(금)");
assert.ok(text.includes("*진짜 문제 (새로)*\n• [데이터] 배너 링크 — 관리자 확인 (B1)"));
assert.ok(text.includes("*오탐·일시적*"));
// 분석 실패면 숫자와 이유, 기록이 없으면 「돌지 않았어요」
assert.ok(dailySlackText(input, null, "11/13(금)", "토큰 만료").includes(":warning: 분석 실패: 토큰 만료"));
const empty = buildDailyInput([], [], { from: "a", to: "b" }, [], ["야간 플로우 점검: 서버가 꺼져 있었음"]);
assert.ok(isEmptyInput(empty));
assert.ok(dailySlackText(empty, null, "11/13(금)").includes("어젯밤 점검이 돌지 않았어요. (야간 플로우 점검: 서버가 꺼져 있었음)"));


// 블록 메시지: 숫자 네 칸, 새 문제 섹션에 할 일·근거 수, 오탐은 아래 작게. 확인 필요는 따로
{
  const message = dailySlackMessage(input, { ...analysis, issues: [...analysis.issues, { title: "참여 적립 문구 없음", kind: "unverified", evidence: ["P1"], action: "", new: true }] }, "11/13(금)");
  const body = JSON.stringify(message.blocks);
  assert.equal(message.text, "디바이스팜 아침 요약 · 11/13(금) — 새 문제 1");
  assert.ok(body.includes("*플로우*\\n1 / 2 통과"));
  assert.ok(body.includes("*배너 링크*") && body.includes("↳ 관리자 확인 · 근거 1건"));
  assert.ok(body.includes(":large_yellow_circle: *확인 필요 1*"));
  assert.ok(body.includes(":white_circle: 오탐·일시적 1: 출석체크"));
  assert.equal(dailySlackMessage(input, null, "11/13(금)", "토큰 만료").text, "디바이스팜 아침 요약 · 11/13(금) — 분석 실패");
}

{
  const none = () => false;
  // 금 09:05 → 보낸다, 이미 있으면 안 보낸다
  assert.equal(dailyReportDue(new Date("2026-11-13T09:05:00"), none), "2026-11-13");
  assert.equal(dailyReportDue(new Date("2026-11-13T09:05:00"), () => true), null);
  // 09시 전·12시 넘어서·주말은 안 보낸다
  assert.equal(dailyReportDue(new Date("2026-11-13T08:59:00"), none), null);
  assert.equal(dailyReportDue(new Date("2026-11-13T12:01:00"), none), null);
  assert.equal(dailyReportDue(new Date("2026-11-14T09:05:00"), none), null);
}

console.log("daily report ok");

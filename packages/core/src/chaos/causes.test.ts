import assert from "node:assert/strict";

import { causesOf, causesPrompt } from "./causes";
import type { ChaosRun, ChaosStep } from "./types";

const step = (no: number, from: string, to: string, errors: ChaosStep["errors"], screenshot?: string): ChaosStep =>
  ({ episode: 1, step: no, at: "", from, state: "", candidates: [], chosen: "press:button:x", chosenProbability: 0.1, to, newState: false, dead: false, errors, warnings: [], ...(screenshot ? { screenshot } : {}) }) as ChaosStep;

const banner = "https://dev.example/a/hZMQ%22%20target=%22_blank%22%3E%3Cimg";
const run = {
  runId: "r",
  deviceId: "A",
  seed: 1,
  startedAt: "",
  finishedAt: "",
  states: 3,
  blocked: [],
  steps: [
    // 같은 단계의 요청 404 + 주소 없는 콘솔 404 → 한 원인
    step(1, "/my", "/my", [
      { kind: "network", message: `GET 404 ${banner}` },
      { kind: "console", message: "Failed to load resource: the server responded with a status of 404 ()" },
    ], "e1.png"),
    // 다른 단계의 RSC 실패(주소가 끝까지 나옴)도 같은 원인
    step(2, "/benefit", "/benefit", [{ kind: "console", message: `Failed to fetch RSC payload for ${banner}%20alt=. Falling back` }]),
    // 빈 화면 두 판정은 한 원인
    step(3, "/my", "/my/address", [
      { kind: "blank", message: "빈 화면: 글자와 이미지가 없습니다." },
      { kind: "layout", message: "/my/address 빈 화면 — 글자·이미지가 하나도 없습니다" },
    ]),
    // 개발 경고·푸시 로그는 참고
    step(4, "/new-sell", "/new-sell", [
      { kind: "console", message: "`DialogContent` requires a `DialogTitle` for the component" },
      { kind: "console", message: "Fcm Error:  TypeError: Failed to fetch\n at https://cdn.example/x.js" },
    ]),
  ],
} as unknown as ChaosRun;

const causes = causesOf(run);
const problems = causes.filter((cause) => cause.level === "problem");
assert.deepEqual(problems.map((cause) => [cause.title, cause.count]), [
  ["깨진 링크 404: /a/hZMQ", 2],
  ["빈 화면: /my/address", 1],
]);
assert.deepEqual(problems[0].signals, ["network", "console"]);
assert.equal(problems[0].firstScreen, "/my");
assert.deepEqual(problems[0].screens, ["/my", "/benefit"]);
assert.equal(problems[0].screenshot, "e1.png");
assert.equal(causes.filter((cause) => cause.level === "note").length, 2);
assert.ok(causesPrompt(run, causes).includes("1. 깨진 링크 404: /a/hZMQ"));
assert.ok(!causesPrompt(run, causes).includes("DialogTitle"));

// 로그에 낸 화면이 적혀 있으면 단계의 출발 화면 대신 그 화면(로그가 늦게 와 다음 단계에 붙어도)
const late = causesOf({ ...run, steps: [step(1, "/notice/8", "/notice/8", [{ kind: "network", message: `GET 404 ${banner}`, screen: "/my" }])] } as ChaosRun);
assert.equal(late[0].firstScreen, "/my");
assert.deepEqual(late[0].screens, ["/my"]);

console.log("chaos causes ok");

// 다른 앱에서 돌아온 뒤 흰 화면은 화면 열 때 흰 화면과 따로 묶는다
{
  const step = (message: string) => ({ episode: 1, step: 1, at: "", from: "/a", state: "", candidates: [], chosen: "otherApp::", chosenProbability: 1, to: "/b", newState: false, dead: false, errors: [{ kind: "blank" as const, message }], warnings: [] });
  const causes = causesOf({ runId: "r", deviceId: "d", seed: 1, startedAt: "", finishedAt: "", steps: [step("/b 빈 화면: 다른 앱에서 돌아온 뒤 글자와 이미지가 없습니다."), step("/b 빈 화면 — 글자·이미지가 하나도 없습니다")], states: 1, blocked: [] });
  assert.deepEqual(causes.map((cause) => cause.title).sort(), ["돌아온 뒤 빈 화면: /b", "빈 화면: /b"]);
}

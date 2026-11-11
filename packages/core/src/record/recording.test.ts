import assert from "node:assert/strict";

import { buildRecording as buildWith, type RecordEvent } from "./recording";

const rules = { homePath: "/home", forbiddenClickNames: ["구매하기", "결제"] };
const buildRecording = (events: RecordEvent[], startPath: string) => buildWith(events, startPath, rules);

const click = (from: string, name: string, to: string, texts: string[] = [], role: "button" | "link" = "button"): RecordEvent => ({ type: "click", at: 0, from, role, name, to, texts });

// 홈 → 혜택 탭 → 내역: 스텝 + 마지막 문구 확인, 화면별 지도 간선
{
  const result = buildRecording(
    [click("/home", "혜택", "/benefit", ["혜택"], "link"), click("/benefit", "OX퀴즈", "/benefit", ["4초"]), click("/benefit", "적립 내역 보기", "/benefit/history", ["적립 내역"])],
    "/home",
  );
  assert.equal(result.cut, null);
  assert.deepEqual(result.steps, [
    { type: "click", target: { role: "link", name: "혜택" } },
    { type: "click", target: { role: "button", name: "OX퀴즈" } },
    { type: "click", target: { role: "button", name: "적립 내역 보기" } },
    { type: "expectText", text: "적립 내역" },
  ]);
  const collect = result.screens.find((screen) => screen.from === "/benefit");
  assert.deepEqual(collect?.buttons.map((button) => [button.name, button.to ?? "", button.texts?.[0]]), [["OX퀴즈", "", "4초"], ["적립 내역 보기", "/benefit/history", "적립 내역"]]);
}

// 반응을 모르는 클릭(경로 그대로·문구 없음)은 스텝에는 남고 지도에는 안 남는다
{
  const result = buildRecording([click("/home", "새로고침", "/home")], "/home");
  assert.equal(result.steps.length, 1);
  assert.deepEqual(result.screens, []);
}

// 홈으로 돌아오는 jump는 홈 스텝, 다른 jump·금지 버튼은 거기서 끊는다(지도 간선은 계속 모은다)
{
  const home = buildRecording([click("/home", "알림", "/alarm", ["알림"]), { type: "jump", at: 0, from: "/alarm", to: "/home" }, click("/home", "메뉴", "/menu", ["메뉴"])], "/home");
  assert.deepEqual(home.steps.map((step) => step.type), ["click", "home", "click", "expectText"]);

  const jumped = buildRecording([click("/home", "알림", "/alarm", ["알림"]), { type: "jump", at: 0, from: "/alarm", to: "/menu" }, click("/menu", "공지", "/notice", ["공지"])], "/home");
  assert.match(jumped.cut ?? "", /클릭 없이 \/menu/);
  assert.deepEqual(jumped.steps.map((step) => step.type), ["click", "expectText"]);
  assert.equal(jumped.screens.length, 2);

  const forbidden = buildRecording([click("/category", "구매하기", "/category/buy")], "/home");
  assert.match(forbidden.cut ?? "", /금지 버튼 「구매하기」/);
}

// 홈이 아닌 곳에서 시작하면 스텝은 없고 지도만 모은다
{
  const result = buildRecording([click("/benefit", "적립 내역 보기", "/benefit/history", ["적립 내역"])], "/benefit");
  assert.deepEqual(result.steps, []);
  assert.match(result.cut ?? "", /홈부터 다시 돌 수 없습니다/);
  assert.equal(result.screens.length, 1);
}

console.log("recording ok");

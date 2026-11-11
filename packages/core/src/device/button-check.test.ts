import assert from "node:assert/strict";

import { checkButtons, summarizeButtons } from "./button-check";
import type { ScreenDriver } from "./driver";
import { sampleApp } from "../config/sample-app";

/** 버튼 이름 → 누르면 생기는 일. 화면 상태는 path·content로 흉내 낸다. */
type Effect = "navigate" | "dialog" | "nothing" | "server-error" | "missing";

function fakeDriver(effects: Record<string, Effect>, buttons: string[], links: string[] = []) {
  const state = { path: "/home", content: "base", restored: 0, pressed: [] as string[] };
  const driver = {
    app: sampleApp,
    currentPath: async () => state.path,
    evaluate: async <T>(script: string) => {
      if (script.includes("querySelectorAll('button")) return [...buttons.map((name) => ({ role: "button", name })), ...links.map((name) => ({ role: "link", name }))] as T;
      if (script.includes("[role=\"heading\"]")) return [`제목-${state.path}`] as T;
      return state.content as T;
    },
    clickButton: async (name: string, role = "button") => {
      state.pressed.push(role === "link" ? `link:${name}` : name);
      if (effects[name] === "missing") throw new Error(`"${name}" 버튼을 찾지 못했습니다.`);
      if (effects[name] === "navigate") state.path = `/next-${name}`;
      if (effects[name] === "dialog" || effects[name] === "server-error") state.content = `dialog-${name}`;
    },
  } as unknown as ScreenDriver;
  const probe = async () => (state.pressed.at(-1) && effects[state.pressed.at(-1) as string] === "server-error" ? [{ kind: "network" as const, message: "POST /x 500" }, { kind: "overflow" as const, message: "가로 넘침" }] : []);
  const restore = async () => {
    state.restored += 1;
    state.path = "/home";
    state.content = "base";
  };
  return { driver, state, deps: { probe, restore, settleMs: 0, screenPath: "/home" } };
}

// 이동·팝업은 반응, 아무 일 없으면 반응 없음, 서버 에러·못 찾음은 에러. 금지어(충전·구매)는 누르지 않는다.
{
  const { driver, state, deps } = fakeDriver(
    { 이동: "navigate", 팝업: "dialog", 장식: "nothing", 저장: "server-error", 사라짐: "missing" },
    ["뒤로가기", "이동", "팝업", "장식", "저장", "사라짐", "포인트 충전", "바로 구매", "이동"],
  );
  const results = await checkButtons(driver, deps);
  assert.deepEqual(
    results.map((item) => [item.name, item.status]),
    [["이동", "reacted"], ["팝업", "reacted"], ["장식", "dead"], ["저장", "error"], ["사라짐", "skipped"]],
  );
  assert.equal(results[0].message, "/next-이동로 이동");
  // 레이아웃 문제(가로 넘침)는 버튼 에러로 보지 않는다
  assert.equal(results[3].message, "POST /x 500");
  // 반응한 버튼(이동·팝업·저장) 뒤마다 화면을 다시 연다
  assert.equal(state.restored, 3);
  assert.deepEqual(state.pressed, ["이동", "팝업", "장식", "저장", "사라짐"]);
  assert.equal(summarizeButtons(results), "버튼 5개 · 반응 없음 1(장식) · 에러 1(저장) · 건너뜀 1");
}

// 링크도 누른다. 하단 탭은 누르지 않는다. 이동한 곳의 경로·문구를 남긴다.
{
  const { driver, state, deps } = fakeDriver({ 출석체크: "navigate" }, [], ["홈", "혜택", "출석체크"]);
  const results = await checkButtons(driver, deps);
  assert.deepEqual(state.pressed, ["link:출석체크"]);
  assert.deepEqual([results[0].role, results[0].to, results[0].texts], ["link", "/next-출석체크", ["제목-/next-출석체크"]]);
}

// 화면당 상한
{
  const names = Array.from({ length: 12 }, (_, index) => `버튼${index}`);
  const { driver, deps } = fakeDriver({}, names);
  assert.equal((await checkButtons(driver, { ...deps, maxButtons: 3 })).length, 3);
}

// 다시 연 화면이 원래 경로가 아니면 남은 버튼은 누르지 않는다
{
  const { driver, state, deps } = fakeDriver({ 이동: "navigate" }, ["이동", "장식", "팝업"]);
  const results = await checkButtons(driver, { ...deps, restore: async () => undefined });
  assert.deepEqual(results.map((item) => item.status), ["reacted", "skipped", "skipped"]);
  assert.match(results[1].message ?? "", /^화면 복귀 실패/);
  assert.deepEqual(state.pressed, ["이동"]);
}

console.log("button-check ok");

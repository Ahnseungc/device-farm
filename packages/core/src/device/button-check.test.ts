import assert from "node:assert/strict";

import { alreadySelectedMessage, buttonShape, buttonStoppedMessage, checkButtons, summarizeButtons } from "./button-check";
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
  assert.equal(summarizeButtons(results), "버튼 5개 · 반응 없음 1(장식) · 에러 1(저장) · 건너뜀 1 · 에러 원인: POST /x 500");
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

// 점검을 멈추면 남은 버튼은 누르지 않는다(급한 QA 제보가 바로 돈다)
{
  const { driver, state, deps } = fakeDriver({}, ["하나", "둘", "셋"]);
  const results = await checkButtons(driver, { ...deps, stopped: () => state.pressed.length >= 1 });
  assert.deepEqual(state.pressed, ["하나"]);
  assert.deepEqual(results.map((item) => [item.name, item.status, item.message]), [["하나", "dead", undefined], ["둘", "skipped", buttonStoppedMessage], ["셋", "skipped", buttonStoppedMessage]]);
}

// 다시 연 화면이 원래 경로가 아니면 남은 버튼은 누르지 않는다
{
  const { driver, state, deps } = fakeDriver({ 이동: "navigate" }, ["이동", "장식", "팝업"]);
  const results = await checkButtons(driver, { ...deps, restore: async () => undefined });
  assert.deepEqual(results.map((item) => item.status), ["reacted", "skipped", "skipped"]);
  assert.match(results[1].message ?? "", /^화면 복귀 실패/);
  assert.deepEqual(state.pressed, ["이동"]);
}

// 화면을 다시 열다 실패해도(전면 광고가 홈 탭을 덮음) 던지지 않고, 그 버튼 결과는 남기고 나머지는 건너뛴다
{
  const { driver, state, deps } = fakeDriver({ 이동: "navigate" }, ["이동", "장식", "팝업"]);
  const failing = async () => Promise.reject(new Error("「홈」 링크를 눌렀지만 /my로 가지 않았습니다.\n스택"));
  const results = await checkButtons(driver, { ...deps, restore: failing });
  assert.deepEqual(results.map((item) => item.status), ["reacted", "skipped", "skipped"]);
  assert.equal(results[1].message, "화면 복귀 실패: 「홈」 링크를 눌렀지만 /my로 가지 않았습니다.");
  assert.deepEqual(state.pressed, ["이동"]);
}

// 복귀가 실패하면 앱을 다시 켜고 이어서 누른다. 화면마다 두 번까지
{
  const { driver, state, deps } = fakeDriver({ 이동: "navigate" }, ["이동", "장식"]);
  let recovered = 0;
  const results = await checkButtons(driver, { ...deps, restore: async () => undefined, recover: async () => { recovered += 1; state.path = "/home"; } });
  assert.deepEqual([recovered, results.map((item) => item.status)], [1, ["reacted", "dead"]]);
  const again = fakeDriver({ 이동: "navigate" }, ["이동", "장식"]);
  let tries = 0;
  const stuck = await checkButtons(again.driver, { ...again.deps, restore: async () => undefined, recover: async () => void (tries += 1) });
  assert.deepEqual([tries, stuck.map((item) => item.status)], [2, ["reacted", "skipped"]]);
}

// 이름에 든 시세가 바뀌어도 같은 버튼을 누른다. 숫자만 다른 버튼이 둘이면 고르지 않는다
{
  assert.equal(buttonShape("금 24K 코인 6,266,738원 -207,712원(3.21%)"), "금 24K 코인 #원 #원(#%)".replace("24K", "#K"));
  const buttons = ["금 100원 -1원"];
  const { driver, state, deps } = fakeDriver({}, buttons);
  const results = await checkButtons(driver, { ...deps, now: () => ((buttons[0] = "금 120원 +3원"), 0) });
  assert.deepEqual(state.pressed, ["금 120원 +3원"]);
  assert.equal(results[0].name, "금 100원 -1원");
}

// 글자는 그대로이고 고른 것만 바뀌면 반응이다(화면을 다시 열지 않는다). 이미 고른 버튼은 반응 없음이 아니다
{
  let chosen = "누적량순";
  let restored = 0;
  const fake = {
    app: sampleApp,
    currentPath: async () => "/list",
    evaluate: async (script: string) => {
      if (script.includes("openModal()")) return ["누적량순", "최신등록순"].map((name) => ({ role: "button", name, selected: name === chosen }));
      if (script.includes('"controls"')) return `controls:${chosen}`;
      return "같은 글자";
    },
    clickButton: async (name: string) => void (chosen = name),
  } as unknown as ScreenDriver;
  const results = await checkButtons(fake, { probe: async () => [], restore: async () => void (restored += 1), settleMs: 0, screenPath: "/list" });
  assert.deepEqual(results.map((item) => [item.name, item.status, item.message]), [["누적량순", "skipped", alreadySelectedMessage], ["최신등록순", "reacted", "선택 상태 바뀜"]]);
  assert.equal(restored, 0);
  assert.ok(results.every((item) => !("selected" in item)));
}

console.log("button-check ok");

// 에러 원인: 버튼마다 첫 문제만, 같은 원인은 한 번, 긴 원인은 자른다
{
  const long = `crash ${"x".repeat(150)}`;
  const summary = summarizeButtons([
    { role: "button", name: "새소식", status: "error", message: "GET 404 https://a.shop.example.com/v1/x · GET 500 https://a.shop.example.com/v1/y" },
    { role: "button", name: "알림", status: "error", message: "GET 404 https://a.shop.example.com/v1/x" },
    { role: "link", name: "추첨", status: "error", message: long },
  ]);
  assert.equal(summary, `버튼 3개 · 에러 3(새소식, 알림, 추첨) · 에러 원인: GET 404 https://a.shop.example.com/v1/x / ${long.slice(0, 100)}…`);
}

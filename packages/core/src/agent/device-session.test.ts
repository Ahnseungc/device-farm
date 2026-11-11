import assert from "node:assert/strict";

import { sampleApp } from "../config/sample-app";
import type { ClickRole, ScreenDriver } from "../device/driver";
import { createDeviceSession } from "./device-session";

// 가짜 앱: 홈에 「혜택」 링크·「구매하기」 버튼, 혜택에 「적립 내역 보기」 버튼
const screens: Record<string, { actions: { role: ClickRole; name: string }[]; texts: string[]; next: Record<string, string> }> = {
  "/home": { actions: [{ role: "link", name: "혜택" }, { role: "button", name: "구매하기" }], texts: ["홈 화면"], next: { "혜택": "/benefit" } },
  "/benefit": { actions: [{ role: "button", name: "적립 내역 보기" }], texts: ["혜택"], next: { "적립 내역 보기": "/benefit/history" } },
  "/benefit/history": { actions: [], texts: ["적립 내역"], next: {} },
};

function fakeDriver(): ScreenDriver & { pressed: string[] } {
  let path = "/home";
  const pressed: string[] = [];
  return {
    app: sampleApp,
    pressed,
    navigate: async () => undefined,
    clickButton: async (name) => {
      pressed.push(name);
      path = screens[path].next[name] ?? path;
    },
    goHome: async () => {
      path = "/home";
    },
    expectText: async () => undefined,
    currentPath: async () => path,
    hasText: async () => false,
    screenshot: async () => Buffer.from("png"),
    evaluate: async <T>(script: string) => (script.includes("buttons()") ? screens[path].actions : screens[path].texts) as T,
    close: async () => undefined,
  };
}

// 보기: 금지 버튼은 목록에서 빠진다. 누르기는 기록(RecordEvent)이 된다
{
  const driver = fakeDriver();
  const session = createDeviceSession(driver, { maxActions: 3, now: () => 1 });
  const home = await session.look();
  assert.deepEqual(home.actions.map((item) => item.name), ["혜택"]);
  const collect = await session.press("link", "혜택");
  assert.equal(collect.path, "/benefit");
  await session.press("button", "적립 내역 보기");
  assert.deepEqual(session.events.map((event) => (event.type === "click" ? `${event.from}>${event.name}>${event.to}` : "")), ["/home>혜택>/benefit", "/benefit>적립 내역 보기>/benefit/history"]);

  // 홈은 jump로 남고, 횟수를 다 쓰면 거절한다
  await session.goHome();
  assert.deepEqual(session.events.at(-1), { type: "jump", at: 1, from: "/benefit/history", to: "/home" });
  await assert.rejects(session.press("link", "혜택"), /횟수를 다 썼습니다/);
  assert.equal(session.actions(), 3);
}

// 금지 버튼·마지막 보기에 없는 이름은 누르지 않는다
{
  const driver = fakeDriver();
  const session = createDeviceSession(driver);
  await session.look();
  await assert.rejects(session.press("button", "구매하기"), /누를 수 없는 버튼/);
  await assert.rejects(session.press("button", "적립 내역 보기"), /마지막 보기 목록에 없습니다/);
  assert.deepEqual(driver.pressed, []);

  await session.reportIssue("내역이 비어 보임");
  assert.deepEqual(session.findings.map((finding) => [finding.path, finding.description, finding.screenshot?.toString()]), [["/home", "내역이 비어 보임", "png"]]);
}

console.log("device-session ok");

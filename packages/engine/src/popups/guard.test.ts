import assert from "node:assert/strict";

import type { ScreenDriver } from "@device-farm/core/device/driver";
import type { PopupInfo } from "@device-farm/core/device/popup";

import { sampleApp } from "@device-farm/core/config/sample-app";

import { targetReachableScript, withPopupGuard, type PopupEvent } from "./guard";

const app = { ...sampleApp, popups: { extraCloseNames: [], resultTitles: ["시간이 초과됐어요"] } };

/** 팝업 하나를 흉내 낸 기기. close에 든 동작을 하면 닫힌다 */
function fakeDevice(popup: PopupInfo | null, closesWith: "dim" | "닫기" | "이동" | "다시 풀기" | "none") {
  let open = popup;
  const calls: string[] = [];
  const driver: ScreenDriver = {
    app,
    navigate: async (path) => void calls.push(`navigate ${path}`),
    goHome: async () => void calls.push("home"),
    clickButton: async (name) => {
      calls.push(`click ${name}`);
      if (open && name === closesWith) open = null;
      else if (open && !open.buttons.some((button) => button.name === name)) throw new Error(`"${name}" 버튼이 다른 요소(div.bg-bg-dim)에 가려져 있습니다.`);
    },
    tapAt: async () => {
      calls.push("dim");
      if (closesWith === "dim") open = null;
    },
    expectText: async () => undefined,
    currentPath: async () => "/benefit",
    hasText: async () => false,
    screenshot: async () => Buffer.from("png"),
    evaluate: async <T>() => open as T,
    close: async () => undefined,
  };
  return { driver, calls, reopen: () => (open = popup) };
}

const notice: PopupInfo = { title: "적립 단위 변경 안내", texts: ["적립 단위 변경 안내", "적립 단위가 바뀌었어요."], buttons: [{ name: "이동", reachable: true }], dim: { x: 200, y: 50 } };
const fast = { wait: async () => undefined, log: () => undefined };

// 홈으로 가기 전에 이미 떠 있는 팝업: 먼저 남기고 닫는다(딤이 안 먹으면 유일한 버튼). 그다음 홈으로 간다.
// 딤 위를 탭하면 팝업만 닫히고 탭은 안 눌려 「/my 화면이 그려지지 않았습니다」가 났다. 그 뒤 플로우 누르기는 그대로
{
  const events: PopupEvent[] = [];
  const device = fakeDevice(notice, "이동");
  const driver = withPopupGuard(device.driver, { ...fast, onPopup: async (event) => void events.push(event) });
  await driver.goHome!();
  assert.deepEqual(device.calls, ["dim", "click 이동", "home"]);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].closedBy, { kind: "press", name: "이동" });
  assert.equal(events[0].path, "/benefit");
  assert.equal(events[0].screenshot?.toString(), "png");
  await driver.clickButton("홈", "link");
  assert.equal(device.calls.at(-1), "click 홈");
}

// 떠 있는 시트는 딤으로 닫는다(가짜 기기는 처음부터 떠 있어 화면을 열기 전에 닫는다)
{
  const events: PopupEvent[] = [];
  const device = fakeDevice({ ...notice, title: "이벤트 한정 판매", buttons: [{ name: "쇼핑 둘러보기", reachable: true }, { name: "다시 보지 않기", reachable: true }] }, "dim");
  const driver = withPopupGuard(device.driver, { ...fast, onPopup: async (event) => void events.push(event) });
  await driver.navigate("/shop");
  assert.deepEqual(device.calls, ["dim", "navigate /shop"]);
  assert.deepEqual(events[0].closedBy, { kind: "dim" });
}

// 누르기 전에 팝업이 떠 있으면 닫고 누른다. 누를 버튼이 팝업 안에 있으면(플로우가 연 팝업) 닫지 않는다
{
  const events: PopupEvent[] = [];
  const device = fakeDevice({ ...notice, buttons: [{ name: "충전 취소하기", reachable: true }, { name: "닫기", reachable: true }] }, "닫기");
  const driver = withPopupGuard(device.driver, { ...fast, onPopup: async (event) => void events.push(event) });
  await driver.clickButton("충전 취소하기");
  assert.deepEqual(device.calls, ["click 충전 취소하기"]);
  assert.equal(events.length, 0);
  await driver.clickButton("금 팔기", "link");
  assert.deepEqual(device.calls.slice(1), ["click 닫기", "click 금 팔기"]);
  assert.deepEqual(events[0].closedBy, { kind: "button", name: "닫기" });
}

// 닫지 못하면 「닫지 못함」으로 남기고 원래 오류를 그대로 낸다
{
  const events: PopupEvent[] = [];
  const device = fakeDevice({ ...notice, buttons: [{ name: "충전하기", reachable: true }, { name: "취소 안 함", reachable: true }], dim: null }, "none");
  const driver = withPopupGuard(device.driver, { ...fast, onPopup: async (event) => void events.push(event) });
  await assert.rejects(driver.clickButton("홈", "link"), /가려져/);
  assert.equal(events[0].closedBy, null);
}

// 화면을 열기 전 떠 있는 팝업을 못 닫으면 앱을 다시 켜서 치우고 연다
{
  const device = fakeDevice({ ...notice, buttons: [{ name: "광고 보고 2배 받기", reachable: true }], dim: null }, "none");
  const relaunched: string[] = [];
  const driver = withPopupGuard({ ...device.driver, relaunch: async () => void (relaunched.push("relaunch"), device.calls.push("relaunch")) }, { ...fast, onPopup: async () => undefined });
  await driver.navigate("/my").catch(() => undefined);
  assert.deepEqual(relaunched, ["relaunch"]);
  assert.ok(device.calls.indexOf("relaunch") < device.calls.indexOf("navigate /my"));
}

// 시간 초과 팝업은 결과다: 닫지 않고 그 자리에서 멈춘다. 팝업 안 버튼(「다시 풀기」)은 그대로 누른다
{
  const timeout: PopupInfo = { title: "아쉽게도 시간이 초과됐어요", texts: ["아쉽게도 시간이 초과됐어요", "방금 놓친 금은 다시 풀고 받아가세요!"], buttons: [{ name: "다시 풀기", reachable: true }], dim: { x: 10, y: 10 } };
  const device = fakeDevice(timeout, "다시 풀기");
  const driver = withPopupGuard(device.driver, { ...fast, onPopup: async () => undefined });
  await assert.rejects(driver.clickButton("정답", "button", "prefix"), /「아쉽게도 시간이 초과됐어요」 팝업이 떠서 멈췄습니다/);
  assert.ok(!device.calls.includes("dim"), "바깥을 눌러 닫지 않는다");
  await driver.clickButton("다시 풀기");
  assert.ok(device.calls.includes("click 다시 풀기"));
  // 문구 확인이 실패할 때도 그 팝업 때문이라고 알린다
  device.reopen();
  const failing = withPopupGuard({ ...device.driver, expectText: async () => Promise.reject(new Error('"정답이에요!" 문구가 10000ms 안에 나오지 않았습니다.')) }, { ...fast, onPopup: async () => undefined });
  await assert.rejects(failing.expectText("정답이에요!", 10_000), /시간이 초과됐어요」 팝업이 떠서 멈췄습니다/);
}

// goHome 안에서 홈 탭 누르기가 딤에 막혀 실패하면 팝업을 남기고 닫은 뒤 다시 간다
{
  const events: PopupEvent[] = [];
  const device = fakeDevice(notice, "이동");
  let homes = 0;
  device.driver.goHome = async () => {
    homes += 1;
    device.calls.push("home");
    if ((await device.driver.evaluate<PopupInfo | null>("")) !== null) throw new Error(`"홈" 링크가 다른 요소(div.bg-bg-dim.absolute)에 가려져 있습니다. 누르지 않았습니다.`);
  };
  const driver = withPopupGuard(device.driver, { ...fast, onPopup: async (event) => void events.push(event) });
  await driver.goHome!();
  // 이미 떠 있던 팝업을 먼저 닫아, 홈 가기는 한 번에 된다
  assert.deepEqual(device.calls, ["dim", "click 이동", "home"]);
  assert.equal(homes, 1);
  assert.deepEqual(events.map((event) => event.closedBy), [{ kind: "press", name: "이동" }]);
}

// 풀팝업: 누를 버튼(「충전 취소하기」)이 팝업 요소 밖에 있어도 화면에서 누를 수 있으면 닫지 않고 남기지 않는다
{
  const events: PopupEvent[] = [];
  const full: PopupInfo = { title: "신청한 충전을 먼저 완료해 주세요", texts: ["신청한 충전을 먼저 완료해 주세요"], buttons: [{ name: "문의하기", reachable: true }], dim: null };
  const device = fakeDevice(full, "none");
  const driver = withPopupGuard(
    { ...device.driver, clickButton: async (name) => void device.calls.push(`click ${name}`), evaluate: async <T>(script: string) => (script.includes("충전 취소하기") ? true : full) as T },
    { ...fast, onPopup: async (event) => void events.push(event) },
  );
  await driver.clickButton("충전 취소하기", "button");
  assert.deepEqual(device.calls, ["click 충전 취소하기"]);
  assert.equal(events.length, 0);
  assert.match(targetReachableScript("충전 취소하기"), /충전 취소하기/);
}

console.log("popup guard ok");

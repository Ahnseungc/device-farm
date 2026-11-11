import assert from "node:assert/strict";

import { sampleApp } from "../config/sample-app";
import { deepLinkUrl } from "./deep-link";
import type { ScreenDriver } from "./driver";
import { samePath, screenSettleMs, waitForScreen, type ScreenState } from "./screen-ready";

const link = (path: string) => deepLinkUrl(path, sampleApp.deepLink);
assert.equal(link("/"), "sampleshop://home");
assert.equal(link("/benefit/history"), "sampleshop://benefit/history");
assert.equal(link("/alarm?tab=1"), "sampleshop://alarm?tab=1");
assert.throws(() => deepLinkUrl("/", { scheme: "", homeHost: "home" }), /deepLink\.scheme/);
assert.equal(samePath("/alarm/", "/alarm"), true);
assert.equal(samePath("/alarm?tab=1", "/alarm"), true);
assert.equal(samePath("/alarm", "/add-address"), false);

function driverWith(states: Array<ScreenState | Error>): ScreenDriver {
  let index = 0;
  const next = () => states[Math.min(index++, states.length - 1)];
  return {
    app: sampleApp,
    navigate: async () => undefined,
    clickButton: async () => undefined,
    expectText: async () => undefined,
    currentPath: async () => "/",
    hasText: async () => false,
    screenshot: async () => Buffer.alloc(0),
    evaluate: async <T>() => {
      const state = next();
      if (state instanceof Error) throw state;
      return state as T;
    },
    close: async () => undefined,
  };
}

const fakeClock = () => {
  let clock = 0;
  return { now: () => clock, sleep: async (ms: number) => void (clock += ms), read: () => clock };
};

const blank: ScreenState = { ready: "complete", path: "/alarm", text: 0, images: 0 };
const loading: ScreenState = { ready: "interactive", path: "/alarm", text: 10, images: 0 };
const drawn: ScreenState = { ready: "complete", path: "/alarm", text: 120, images: 3 };

// 빈 화면·로딩 중을 지나 다 그려지고, 한 번 더 같을 때 통과
{
  const clock = fakeClock();
  const result = await waitForScreen(driverWith([new Error("no webview"), blank, loading, drawn, drawn]), "/alarm", clock);
  assert.deepEqual(result, { ok: true });
  assert.ok(clock.read() >= screenSettleMs);
}

// 다른 화면에 머물면 이동 실패
{
  const stuck: ScreenState = { ready: "complete", path: "/add-address", text: 80, images: 1 };
  const result = await waitForScreen(driverWith([stuck]), "/alarm", { ...fakeClock(), timeoutMs: 2_000 });
  assert.deepEqual(result, { ok: false, message: "이동 실패: /alarm 대신 /add-address에 머물렀습니다." });
}

// 끝내 빈 화면이면 그려지지 않음 (첫 점검의 하얀 화면 52장)
{
  const result = await waitForScreen(driverWith([blank]), "/alarm", { ...fakeClock(), timeoutMs: 2_000 });
  assert.deepEqual(result, { ok: false, message: "/alarm 화면이 2초 안에 그려지지 않았습니다." });
}

// 로그인 화면으로 튕기면 바로 돌려준다(판정은 checkScreen)
{
  const result = await waitForScreen(driverWith([{ ready: "complete", path: "/login", text: 5, images: 0 }]), "/alarm", fakeClock());
  assert.deepEqual(result, { ok: true });
}

// 표시가 사라진 새 문서인데 경로가 다르면 리다이렉트 (/add-address/complete → /add-address)
{
  const parent: ScreenState = { ready: "complete", path: "/add-address", text: 300, images: 8, stale: false };
  const result = await waitForScreen(driverWith([parent, parent]), "/add-address/complete", fakeClock());
  assert.deepEqual(result, { ok: true, redirectedTo: "/add-address" });
}

// 표시가 남은 옛 문서면 앱이 화면을 안 연 것
{
  const old: ScreenState = { ready: "complete", path: "/home", text: 300, images: 8, stale: true };
  const result = await waitForScreen(driverWith([old]), "/alarm", { ...fakeClock(), timeoutMs: 2_000 });
  assert.deepEqual(result, { ok: false, message: "이동 실패: 앱이 /alarm를 열지 않아 /home에 머물렀습니다." });
}

console.log("screen-ready ok");

import assert from "node:assert/strict";

import type { KakaoLoginConfig } from "@device-farm/core/config/app-config";

import { loginScreenOf, notificationAllowPoint, reloginWithKakao, type KakaoLoginDeps, type Screenshot } from "./kakao-login";

/** 흰 화면에 probe 자리만 색칠한 가짜 스크린샷 */
function shotWith(probes: readonly { x: number; y: number; rgb: readonly number[] }[]): Screenshot {
  const width = 108;
  const height = 240;
  const data = new Uint8Array(width * height * 4).fill(255);
  for (const { x, y, rgb } of probes) {
    const index = (width * Math.round(height * y) + Math.round(width * x)) * 4;
    data.set(rgb, index);
  }
  return { width, height, data };
}
const config: KakaoLoginConfig = {
  probes: [
    { x: 0.2, y: 0.6, rgb: [254, 229, 0] },
    { x: 0.2, y: 0.7, rgb: [0, 0, 0] },
  ],
  button: { x: 0.5, y: 0.6 },
  notice: { probes: [{ x: 0.5, y: 0.25, rgb: [153, 153, 153] }], closeButton: { x: 0.3, y: 0.6 } },
};
const login = shotWith(config.probes);
const notice = shotWith(config.notice!.probes);
const home = shotWith([]);

assert.equal(loginScreenOf(login, config), "login");
assert.equal(loginScreenOf(notice, config), "notice");
assert.equal(loginScreenOf(home, config), "other");
// 확인할 픽셀이 없으면 로그인 화면으로 보지 않는다
assert.equal(loginScreenOf(login, { probes: [], button: config.button }), "other");

function fake(shots: Screenshot[], steps: { focus: string[]; picked?: string | null; readyAfter: number }) {
  const calls: string[] = [];
  let shot = 0;
  let focus = 0;
  let readyChecks = 0;
  let clock = 0;
  const deps: KakaoLoginDeps = {
    screenshot: async () => shots[Math.min(shot++, shots.length - 1)],
    tap: async (x, y) => void calls.push(`tap ${x},${y}`),
    focus: async () => steps.focus[Math.min(focus++, steps.focus.length - 1)],
    selectAccount: async () => (calls.push("select"), steps.picked ?? null),
    appReady: async () => ++readyChecks > steps.readyAfter,
    sleep: async (ms) => void (clock += ms),
    now: () => clock,
  };
  return { deps, calls };
}
const times = { settleMs: 100, pickerWaitMs: 5_000, readyWaitMs: 5_000, pollMs: 1_000 };
const chrome = "com.android.chrome/org.chromium.chrome.browser.customtabs.CustomTabActivity";

// 안내 팝업 「닫기」 → 「카카오로 시작하기」 → 계정 고르기 → 앱이 다시 붙으면 로그인 끝
{
  const { deps, calls } = fake([notice, login, login, login], { focus: [chrome], picked: "user@example.com", readyAfter: 2 });
  assert.equal(await reloginWithKakao(config, deps, times), "logged-in");
  assert.deepEqual(calls, ["tap 32,144", "tap 54,144", "select"]);
}

// 로그인 화면이 아니면 아무것도 누르지 않는다(모르는 화면을 좌표로 누르지 않는다)
{
  const { deps, calls } = fake([home], { focus: [chrome], readyAfter: 0 });
  assert.equal(await reloginWithKakao(config, deps, times), "not-login");
  assert.deepEqual(calls, []);
}

// 카카오가 계정을 기억하면 선택 화면 없이 바로 돌아온다
{
  const { deps, calls } = fake([login], { focus: ["app"], readyAfter: 0 });
  assert.equal(await reloginWithKakao(config, deps, times), "logged-in");
  assert.deepEqual(calls, ["tap 54,144"]);
}

// 계정 선택 화면이 끝내 안 뜨면 실패
{
  const { deps } = fake([login], { focus: ["app"], readyAfter: 1_000 });
  await assert.rejects(reloginWithKakao(config, deps, times), /고를 카카오 계정이 없었습니다/);
}

// 알림 권한 창: 앱 알림 창이면 「허용」 가운데, 다른 권한(위치 등)이면 누르지 않는다
{
  const prompt = (message: string) =>
    `<hierarchy><node index="0" text="${message}" resource-id="com.android.permissioncontroller:id/permission_message" bounds="[90,1841][990,1895]" />` +
    `<node index="1" text="허용" resource-id="com.android.permissioncontroller:id/permission_allow_button" bounds="[64,1937][1016,2032]" />` +
    `<node index="2" text="허용 안함" resource-id="com.android.permissioncontroller:id/permission_deny_button" bounds="[64,2074][1016,2169]" /></hierarchy>`;
  assert.deepEqual(notificationAllowPoint(prompt("샘플 샵 DEV에서 알림을 보내도록 허용하시겠습니까?"), "샘플 샵"), { x: 540, y: 1985 });
  assert.equal(notificationAllowPoint(prompt("샘플 샵 DEV에서 이 기기의 위치에 액세스하도록 허용하시겠습니까?"), "샘플 샵"), null);
  assert.equal(notificationAllowPoint(prompt("다른 앱에서 알림을 보내도록 허용하시겠습니까?"), "샘플 샵"), null);
}

console.log("kakao login ok");

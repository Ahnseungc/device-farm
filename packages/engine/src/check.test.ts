import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { PNG } from "pngjs";

import { diffMessage } from "@device-farm/core/baseline/diff";
import type { ScreenDriver } from "@device-farm/core/device/driver";
import { popupScript, type PopupInfo } from "@device-farm/core/device/popup";
import type { Device } from "@device-farm/core/device/types";
import type { ScreenScenario } from "@device-farm/core/scenarios";

import {
  baselineKey,
  blankStatusBar,
  busyScript,
  checkScreen,
  confirmDeviceBaselines,
  pendingDeviceBaselines,
  popupKeptNote,
  statusBarIgnore,
} from "./check";
import { sampleApp } from "@device-farm/core/config/sample-app";

// 화면 준비 대기는 screen-ready.test.ts가 본다. 여기서는 바로 준비된 것으로 둔다.
const ready = async () => ({ ok: true }) as const;

const width = 100;
const height = 100;

function png(changedPixels = 0, statusBarValue = 200): Buffer {
  const image = new PNG({ width, height });
  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 4;
    const inStatusBar = index < width * 8;
    const changed = !inStatusBar && index - width * 8 < changedPixels;
    const value = inStatusBar ? statusBarValue : changed ? 0 : 200;
    image.data[offset] = value;
    image.data[offset + 1] = value;
    image.data[offset + 2] = value;
    image.data[offset + 3] = 255;
  }
  return PNG.sync.write(image);
}

function fakeDriver(options: { path?: string; appError?: boolean; shot?: Buffer }): ScreenDriver {
  return {
    app: sampleApp,
    navigate: async () => {},
    clickButton: async () => {},
    expectText: async () => {},
    currentPath: async () => options.path ?? "/",
    hasText: async (text) => options.appError === true && text === "Application error",
    screenshot: async () => options.shot ?? png(),
    evaluate: async <T>() => undefined as T,
    close: async () => {},
  };
}

const device: Device = { id: "R3CN", platform: "android", model: "SM-S918N", osVersion: "14", appVersion: "2.1.5" };
const otherOs: Device = { ...device, osVersion: "15" };
const scenario: ScreenScenario = { path: "/alarm", name: "알림", when: "알림 화면을 연다", then: "알림 화면이 보인다" };

assert.notEqual(baselineKey(device, "알림"), baselineKey(otherOs, "알림"));
assert.equal(baselineKey(device, "알림"), "SM-S918N|14|알림");
assert.deepEqual(statusBarIgnore(device, width, height), { x: 0, y: 0, width, height: 8 });

const root = mkdtempSync(path.join(tmpdir(), "check-test-"));
try {
  const appError = await checkScreen(fakeDriver({ appError: true }), device, scenario, root, ready);
  assert.deepEqual(appError, { status: "failed", message: "/alarm 에서 앱 오류가 났습니다." });

  const login = await checkScreen(fakeDriver({ path: "/login" }), device, scenario, root, ready);
  assert.equal(login.status, "login_required");
  assert.equal(existsSync(root) ? readdirSync(root).length : 0, 0);
  // 로그인 화면 자체를 보는 시나리오는 로그인 필요가 아니다
  const loginScreen = await checkScreen(fakeDriver({ path: "/id-sign-in" }), device, { ...scenario, path: "/id-sign-in", name: "아이디 로그인" }, mkdtempSync(path.join(tmpdir(), "check-login-")), ready);
  assert.notEqual(loginScreen.status, "login_required");

  const first = await checkScreen(fakeDriver({}), device, scenario, root, ready);
  assert.equal(first.status, "candidate");
  assert.deepEqual(pendingDeviceBaselines(root), ["SM-S918N|14|알림"]);
  assert.equal(confirmDeviceBaselines(undefined, root), 1);

  const otherDevice = await checkScreen(fakeDriver({}), otherOs, scenario, root, ready);
  assert.equal(otherDevice.status, "candidate");
  assert.equal(confirmDeviceBaselines(["SM-S918N|15|알림"], root), 1);

  const statusBarOnly = await checkScreen(fakeDriver({ shot: png(0, 30) }), device, scenario, root, ready);
  assert.equal(statusBarOnly.status, "passed");
  assert.match(statusBarOnly.message ?? "", /^기준 학습 중\(2\/4\)/);

  // 확정 뒤 첫 몇 번은 바뀌는 곳을 배운다: 3% 바뀌어도 통과하고, 그 자리는 비교에서 빠진다
  for (const step of [3, 4]) {
    const learning = await checkScreen(fakeDriver({ shot: png(300) }), device, scenario, root, ready);
    assert.equal(learning.status, "passed");
    assert.match(learning.message ?? "", new RegExp(`^기준 학습 중\\(${step}/4\\)`));
  }
  const learned = await checkScreen(fakeDriver({ shot: png(300) }), device, scenario, root, ready);
  assert.deepEqual({ status: learned.status, message: learned.message }, { status: "passed", message: undefined });

  // 배운 뒤에는 다른 곳이 바뀌면 실패다
  const elsewhere = await checkScreen(fakeDriver({ shot: png(700) }), device, scenario, root, ready);
  assert.deepEqual({ status: elsewhere.status, message: elsewhere.message }, { status: "failed", message: diffMessage });

  // 배우는 중이라도 화면이 통째로 바뀌면(30% 넘게) 배우지 않고 실패다
  const whole = await checkScreen(fakeDriver({ shot: png(5000) }), otherOs, scenario, root, ready);
  assert.deepEqual({ status: whole.status, message: whole.message }, { status: "failed", message: diffMessage });

  const blanked = PNG.sync.read(blankStatusBar(png(), device));
  assert.equal(blanked.data[0], 0);
  assert.equal(blanked.data[width * 8 * 4], 200);
} finally {
  rmSync(root, { recursive: true, force: true });
}

// 화면이 안 그려지면 후보로 남기지 않고 실패
{
  const notReady = async () => ({ ok: false, message: "이동 실패: /x 대신 /add-my-jewelry에 머물렀습니다." }) as const;
  const result = await checkScreen(fakeDriver({}), device, { ...scenario, name: "안 그려진 화면" }, root, notReady);
  assert.deepEqual(result, { status: "failed", message: "이동 실패: /x 대신 /add-my-jewelry에 머물렀습니다." });
}

// 들어올 때마다 늦게 뜨는 안내 시트: 다시 열어도 또 뜬다. X에 이름이 없어 딤으로 닫고 비교한다.
// 다른 화면으로 가는 「예상견적 확인하기」는 누르지 않는다. 닫히지 않는 팝업은 여전히 실패다.
{
  const sheet: PopupInfo = {
    title: "먼저 예상견적부터 확인해 볼까요?",
    texts: ["먼저 예상견적부터 확인해 볼까요?", "내 금이 얼마 정도인지", "예상견적 확인하기"],
    buttons: [{ name: "예상견적 확인하기", reachable: true }],
    dim: { x: 180, y: 48 },
  };
  function sheetDriver(closable: boolean) {
    const pressed: string[] = [];
    let open = true;
    const driver: ScreenDriver = {
      ...fakeDriver({ path: "/legacy" }),
      navigate: async () => {
        open = true;
      },
      clickButton: async (name) => {
        pressed.push(name);
      },
      tapAt: async () => {
        pressed.push("딤");
        if (closable) open = false;
      },
      evaluate: async <T>(script: string) => (script === popupScript && open ? sheet : null) as T,
    };
    return { driver, pressed };
  }
  const sheetRoot = mkdtempSync(path.join(tmpdir(), "check-popup-"));
  try {
    const direct: ScreenScenario = { path: "/legacy", name: "직접 방문 안내", when: "연다", then: "보인다" };
    const closed = sheetDriver(true);
    const passed = await checkScreen(closed.driver, device, direct, sheetRoot, ready);
    assert.equal(passed.status, "candidate");
    assert.deepEqual(closed.pressed, ["딤"]);

    const stuck = sheetDriver(false);
    // 다시 열어도 또 뜨고 닫히지도 않는 팝업은 화면의 일부로 보고 팝업째 기준으로 남긴다(실패 아님)
    const kept = await checkScreen(stuck.driver, device, { ...direct, name: "직접 방문 안내 못 닫음" }, sheetRoot, ready);
    assert.deepEqual({ status: kept.status, message: kept.message }, { status: "candidate", message: popupKeptNote("먼저 예상견적부터 확인해 볼까요?") });
    assert.ok(!stuck.pressed.includes("예상견적 확인하기"));
    assert.deepEqual(pendingDeviceBaselines(sheetRoot), ["SM-S918N|14|직접 방문 안내", "SM-S918N|14|직접 방문 안내 못 닫음"]);
  } finally {
    rmSync(sheetRoot, { recursive: true, force: true });
  }
}

// 개발용 스플래시 미리보기가 덮은 화면은 닫고 다시 찍어 비교한다
// 로딩이 보이면 끝날 때까지 기다렸다 찍는다
{
  const previewRoot = mkdtempSync(path.join(tmpdir(), "check-preview-"));
  try {
    const item: ScreenScenario = { ...scenario, name: "미리보기" };
    const driver = fakeDriver({ path: "/alarm" });
    await checkScreen(driver, device, item, previewRoot, ready);
    confirmDeviceBaselines(undefined, previewRoot);
    let covered = true;
    let closed = 0;
    const preview: ScreenDriver = { ...driver, screenshot: async () => (covered ? png(5000) : png()), closeDevPreview: async () => ((closed += 1), (covered = false), true) };
    assert.equal((await checkScreen(preview, device, item, previewRoot, ready)).status, "passed");
    assert.equal(closed, 1);
    // 같은 화면이면 덤프를 뜨지 않는다
    assert.equal((await checkScreen(preview, device, item, previewRoot, ready)).status, "passed");
    assert.equal(closed, 1);

    let busy = 2;
    const loading: ScreenDriver = {
      ...driver,
      evaluate: async <T>(script: string) => (script === busyScript ? (busy -= 1) >= 0 : undefined) as T,
      screenshot: async () => (busy >= 0 ? png(5000) : png()),
    };
    assert.equal((await checkScreen(loading, device, { ...item, name: "로딩" }, previewRoot, ready)).status, "candidate");
    assert.equal(busy, -1);
  } finally {
    rmSync(previewRoot, { recursive: true, force: true });
  }
}

console.log("check ok");

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { PNG } from "pngjs";

import { diffMessage } from "@device-farm/core/baseline/diff";
import type { ScreenDriver } from "@device-farm/core/device/driver";
import type { Device } from "@device-farm/core/device/types";
import type { ScreenScenario } from "@device-farm/core/scenarios";

import {
  baselineKey,
  blankStatusBar,
  checkScreen,
  confirmDeviceBaselines,
  pendingDeviceBaselines,
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

  const first = await checkScreen(fakeDriver({}), device, scenario, root, ready);
  assert.equal(first.status, "candidate");
  assert.deepEqual(pendingDeviceBaselines(root), ["SM-S918N|14|알림"]);
  assert.equal(confirmDeviceBaselines(undefined, root), 1);

  const otherDevice = await checkScreen(fakeDriver({}), otherOs, scenario, root, ready);
  assert.equal(otherDevice.status, "candidate");
  assert.equal(confirmDeviceBaselines(["SM-S918N|15|알림"], root), 1);

  const statusBarOnly = await checkScreen(fakeDriver({ shot: png(0, 30) }), device, scenario, root, ready);
  assert.equal(statusBarOnly.status, "passed");

  const threePercent = await checkScreen(fakeDriver({ shot: png(300) }), device, scenario, root, ready);
  assert.deepEqual({ status: threePercent.status, message: threePercent.message }, { status: "failed", message: diffMessage });

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

console.log("check ok");

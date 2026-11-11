import path from "node:path";

import { PNG } from "pngjs";

import { isLoginPath, type ScreenDriver } from "@device-farm/core/device/driver";
import { waitForScreen, type ScreenReady } from "@device-farm/core/device/screen-ready";
import type { Device, ScreenStatus } from "@device-farm/core/device/types";
import type { ScreenScenario } from "@device-farm/core/scenarios";

import { compareToBaseline, confirmPending, confirmScenario, hasBaseline, readPending, saveCandidate } from "./baseline/store";

export const deviceBaselinesRoot = path.resolve("test-results/device-baselines");

/** 모르는 기기의 상태바 비율. Dynamic Island 기기가 약 7%라 넉넉히 8% (작성자 판단) */
export const statusBarFallbackRatio = 0.08;

/** 기기 모델 → 세로 상태바 픽셀 높이. `adb shell dumpsys window`의 ITYPE_STATUS_BAR frame으로 잰다. */
export const statusBarHeights: Readonly<Record<string, number>> = {
  "SM-A325N": 80, // 갤럭시 A32, Android 13, 1080x2400 (2026-10-26 실측)
  "iPhone 16": 177, // 안전 영역 위 59pt × 3배. 캡처 1178x2556 (2026-10-26 확인)
};

export type IgnoreBox = { x: number; y: number; width: number; height: number };

export type ScreenCheck = { status: ScreenStatus; message?: string; screenshot?: Buffer };

export function baselineKey(device: Device, scenario: string): string {
  return `${device.model}|${device.osVersion}|${scenario}`;
}

export function statusBarIgnore(device: Device, width: number, height: number): IgnoreBox {
  const barHeight = statusBarHeights[device.model] ?? Math.round(height * statusBarFallbackRatio);
  return { x: 0, y: 0, width, height: Math.min(barHeight, height) };
}

/**
 * 상태바를 검게 칠한다. 복사한 store.ts의 `compareToBaseline`에는 무시 영역 인자가 없어서
 * 후보·비교 둘 다 칠한 PNG를 넘겨 같은 효과를 낸다.
 */
export function blankStatusBar(png: Buffer, device: Device): Buffer {
  const image = PNG.sync.read(png);
  const box = statusBarIgnore(device, image.width, image.height);
  const end = box.height * image.width * 4;
  for (let offset = 0; offset < end; offset += 4) {
    image.data[offset] = 0;
    image.data[offset + 1] = 0;
    image.data[offset + 2] = 0;
    image.data[offset + 3] = 255;
  }
  return PNG.sync.write(image);
}

/** 화면 하나 판정. 앱 오류 → 로그인 이탈 → 기준 없음(후보) → 기준 비교 순서. */
export async function checkScreen(
  driver: ScreenDriver,
  device: Device,
  scenario: ScreenScenario,
  baselineRoot = deviceBaselinesRoot,
  waitFor: (driver: ScreenDriver, path: string) => Promise<ScreenReady> = (target, path) => waitForScreen(target, path),
): Promise<ScreenCheck> {
  await driver.navigate(scenario.path);
  // 다 그려지기 전·안 열린 화면을 찍어 후보로 남기지 않는다.
  const ready = await waitFor(driver, scenario.path);
  if (!ready.ok) return { status: "failed", message: ready.message };
  const note = ready.redirectedTo ? `${ready.redirectedTo}로 이동됨` : undefined;
  const { appErrorText, loginPaths } = driver.app;
  if (await driver.hasText(appErrorText)) {
    return { status: "failed", message: `${scenario.path} 에서 앱 오류가 났습니다.` };
  }
  if (isLoginPath(await driver.currentPath(), loginPaths)) return { status: "login_required" };
  const screenshot = blankStatusBar(await driver.screenshot(), device);
  const key = baselineKey(device, scenario.name);
  if (!hasBaseline(key, baselineRoot)) {
    saveCandidate(key, screenshot, baselineRoot);
    return { status: "candidate", message: note, screenshot };
  }
  const result = compareToBaseline(key, screenshot, baselineRoot);
  if (result.pass) return { status: "passed", message: note, screenshot };
  return { status: "failed", message: result.message, screenshot };
}

/** 확정을 기다리는 기기 기준 키 */
export function pendingDeviceBaselines(root = deviceBaselinesRoot): string[] {
  return readPending(root);
}

/** 후보를 기준으로 확정한다. 이름을 안 주면 전부. 확정한 수를 돌려준다. */
export function confirmDeviceBaselines(names?: readonly string[], root = deviceBaselinesRoot): number {
  if (!names) return confirmPending(root);
  return names.filter((name) => confirmScenario(name, root)).length;
}

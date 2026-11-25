import path from "node:path";

import { PNG } from "pngjs";

import { popupCloseSteps, popupScript, type PopupInfo } from "@device-farm/core/device/popup";
import { sleep } from "@device-farm/core/sleep";
import { isLoginPath, type ScreenDriver } from "@device-farm/core/device/driver";
import { normalizePath, samePath, waitForScreen, type ScreenReady } from "@device-farm/core/device/screen-ready";
import type { Device, ScreenStatus } from "@device-farm/core/device/types";
import type { ScreenScenario } from "@device-farm/core/scenarios";

import { popupCloseSettleMs } from "./popups/guard";
import { diffRatio, failRatio } from "@device-farm/core/baseline/diff";
import { baselineDiffRatio, compareToBaseline, confirmPending, confirmScenario, hasBaseline, learnSample, readPending, sampleCount, saveCandidate } from "./baseline/store";

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

/** 기준을 이만큼 모을 때까지(확정 1장 포함) 바뀌는 곳을 배운다 (작성자 판단) */
export const baselineLearnSamples = 4;

/** 배울 때 바뀐 곳이 이 비율을 넘으면 화면이 달라진 것으로 보고 배우지 않는다 (작성자 판단) */
export const baselineLearnMaxRatio = 0.3;

/** 다시 열어도 또 뜨는 팝업을 화면의 일부로 함께 비교했을 때 남기는 문구 */
export const popupKeptNote = (title: string) => `「${title}」 팝업이 늘 떠서 함께 비교했습니다`;

/** 로딩이 끝나기를 기다리는 최대 시간·간격, 찍은 두 장이 같다고 보는 비율·간격·최대 장수 (작성자 판단) */
export const settleLimits = { busyMs: 8_000, pollMs: 250, sameRatio: 0.005, betweenMs: 700, maxShots: 4 } as const;

/**
 * 로딩 화면이 보이는가: 화면 30% 이상을 덮는 aria-busy, 또는 가려지지 않은 24px 이상 도는 표시.
 */
export const busyScript = `(() => {
  const shown = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0.05 ? r : null; };
  const onTop = (el, r) => { const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return Boolean(hit) && (hit === el || el.contains(hit) || hit.contains(el)); };
  const covers = Array.from(document.querySelectorAll('[aria-busy="true"]')).some((el) => { const r = shown(el); return r && r.width * r.height >= innerWidth * innerHeight * 0.3 && onTop(el, r); });
  const spins = Array.from(document.querySelectorAll('.animate-spin, [class*="spinner" i]')).some((el) => { const r = shown(el); return r && r.width >= 24 && r.y >= 0 && r.bottom <= innerHeight && onTop(el, r); });
  return covers || spins;
})()`;

/** 로딩이 끝나기를 기다린다. 기다렸으면 true */
async function waitWhileBusy(driver: ScreenDriver): Promise<boolean> {
  const deadline = Date.now() + settleLimits.busyMs;
  let waited = false;
  while (Date.now() < deadline && (await driver.evaluate<boolean>(busyScript).catch(() => false)) === true) {
    waited = true;
    await sleep(settleLimits.pollMs);
  }
  return waited;
}

/** 멈춘 화면을 찍는다. 잇달아 찍은 두 장이 같을 때까지(계속 움직이는 화면은 마지막 장) */
async function settledShot(driver: ScreenDriver, device: Device): Promise<Buffer> {
  let shot = blankStatusBar(await driver.screenshot(), device);
  for (let count = 1; count < settleLimits.maxShots; count += 1) {
    await sleep(settleLimits.betweenMs);
    const next = blankStatusBar(await driver.screenshot(), device);
    const ratio = diffRatio(PNG.sync.read(next), PNG.sync.read(shot), null);
    shot = next;
    if (ratio !== null && ratio <= settleLimits.sameRatio) break;
  }
  return shot;
}

/** 보이는 팝업 제목. 없으면 null */
async function popupOpen(driver: ScreenDriver): Promise<string | null> {
  const info = await driver.evaluate<PopupInfo | null>(popupScript).catch(() => null);
  return info ? info.title || "제목 없음" : null;
}

/**
 * 남은 팝업을 사람처럼 닫아 본다(닫기류 버튼 → 바깥 딤). 다른 화면으로 넘어가는 버튼(press)은 누르지 않는다.
 * 들어올 때마다 늦게 뜨는 안내 시트는 다시 열어도 또 떠서 다시 열기만으로는 못 치웠다
 *.
 */
async function closePopup(driver: ScreenDriver): Promise<void> {
  const info = await driver.evaluate<PopupInfo | null>(popupScript).catch(() => null);
  if (!info) return;
  for (const step of popupCloseSteps(info, Boolean(driver.tapAt), driver.app.popups.extraCloseNames)) {
    try {
      if (step.kind === "press") continue;
      if (step.kind === "dim") await driver.tapAt!(info.dim!.x, info.dim!.y);
      else await driver.clickButton(step.name, "button");
    } catch {
      continue;
    }
    await sleep(popupCloseSettleMs);
    if ((await popupOpen(driver)) !== info.title) return;
  }
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
  let note = ready.redirectedTo ? `${ready.redirectedTo}로 이동됨` : undefined;
  // 로딩이 끝나며 다른 화면으로 넘어가기도 한다(결제 → 카테고리)
  if (await waitWhileBusy(driver)) {
    const path = await driver.currentPath();
    if (!samePath(scenario.path, path)) note = `${normalizePath(path)}로 이동됨`;
  }
  const { appErrorText, loginPaths } = driver.app;
  if (await driver.hasText(appErrorText)) {
    return { status: "failed", message: `${scenario.path} 에서 앱 오류가 났습니다.` };
  }
  // 로그인 화면 자체를 보는 시나리오(「아이디 로그인 화면」)는 로그인이 풀린 것이 아니다. 이걸 로그인 필요로 봐 점검 전체가 멈췄다
  if (!isLoginPath(scenario.path, loginPaths) && isLoginPath(await driver.currentPath(), loginPaths)) return { status: "login_required" };
  // 늦게 뜬 이벤트 팝업이 찍히면 기준이 기간 끝나는 날 깨진다.
  // 찍기 전에 팝업이 보이면 다시 열어 닫게 하고(팝업 가드), 또 보이면 직접 닫아 본다.
  let stuckPopup: string | null = null;
  if (await popupOpen(driver)) {
    await driver.navigate(scenario.path);
    await waitFor(driver, scenario.path);
    if (await popupOpen(driver)) await closePopup(driver);
    // 다시 열어도 또 뜨고 닫히지도 않는 팝업은 그 화면의 일부다(작성 중이던 글 이어하기, 안내 시트 등).
    // 실패로 두면 앱이 맞는데 오류 알림이 갔다. 팝업째 기준·비교한다.
    const title = await popupOpen(driver);
    if (title) stuckPopup = title;
  }
  const withPopup = (text: string | undefined) => (stuckPopup ? (text ? `${text} · ${popupKeptNote(stuckPopup)}` : popupKeptNote(stuckPopup)) : text);
  const key = baselineKey(device, scenario.name);
  let screenshot = await settledShot(driver, device);
  // 기준이 없거나 기준과 다르면, 개발용 미리보기가 덮은 것인지 보고 닫은 뒤 다시 찍는다
  const differs = !hasBaseline(key, baselineRoot) || (baselineDiffRatio(key, screenshot, baselineRoot) ?? 1) > failRatio;
  if (differs && (await driver.closeDevPreview?.().catch(() => false))) screenshot = await settledShot(driver, device);
  if (!hasBaseline(key, baselineRoot)) {
    saveCandidate(key, screenshot, baselineRoot);
    return { status: "candidate", message: withPopup(note), screenshot };
  }
  // 확정 뒤 첫 몇 번은 바뀌는 곳(시세·잔액·시각·목록)을 배운다. 한 장으로 확정한 기준이 다음 점검에서 14개 어긋났다.
  // 바뀐 곳이 너무 넓으면(화면이 통째로 달라짐) 배우지 않고 실패로 둔다.
  const samples = sampleCount(key, baselineRoot);
  if (samples < baselineLearnSamples) {
    const ratio = baselineDiffRatio(key, screenshot, baselineRoot);
    if (ratio !== null && ratio <= baselineLearnMaxRatio) {
      learnSample(key, screenshot, baselineRoot);
      const learning = `기준 학습 중(${samples + 1}/${baselineLearnSamples}): 바뀌는 곳을 비교에서 뺐습니다.`;
      return { status: "passed", message: withPopup(note ? `${note} · ${learning}` : learning), screenshot };
    }
  }
  const result = compareToBaseline(key, screenshot, baselineRoot);
  if (result.pass) return { status: "passed", message: withPopup(note), screenshot };
  return { status: "failed", message: stuckPopup ? `${result.message} (${popupKeptNote(stuckPopup)})` : result.message, screenshot };
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

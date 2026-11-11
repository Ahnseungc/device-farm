import { setTimeout as wait } from "node:timers/promises";

import { remote } from "webdriverio";

import { appiumConnection, iosCapabilities, type IosSigning } from "./ios-session";

export const testflightBundleId = "com.apple.TestFlight";
/** 화면이 바뀐 뒤 기다리는 시간, 찾을 때까지 스크롤하는 횟수 (작성자 판단) */
export const testflightUi = { settleMs: 2_500, maxSwipes: 6 } as const;

/** 「이전 빌드」 안의 버전 묶음 버튼 앞부분. 라벨은 `2.0.20, 3개의 빌드` */
export function versionGroupPrefix(version: string): string {
  return `${version.split("+")[0]},`;
}

/** 버전 묶음 안의 빌드 줄 라벨. `2.0.20+426` → `2.0.20(426)`. 빌드 번호가 없으면 맨 위(최신) 줄을 고른다. */
export function buildRowLabel(version: string): string | null {
  const [display, build] = version.split("+");
  return build ? `${display}(${build})` : null;
}

/** 빌드 줄과 같은 높이의 「설치」 버튼. 줄마다 버튼 라벨이 같아 위치로 고른다. */
export function nearestByY<T extends { y: number }>(target: number, items: readonly T[]): T | null {
  return items.reduce<T | null>((best, item) => (!best || Math.abs(item.y - target) < Math.abs(best.y - target) ? item : best), null);
}

type Browser = WebdriverIO.Browser;
const byLabel = (browser: Browser, predicate: string) => browser.$(`-ios predicate string:${predicate}`);

/** 보일 때까지 아래로 스크롤하며 찾는다. */
async function findScrolling(browser: Browser, predicate: string) {
  for (let swipe = 0; swipe <= testflightUi.maxSwipes; swipe += 1) {
    const element = byLabel(browser, predicate);
    if ((await element.isExisting()) && (await element.isDisplayed())) return element;
    await browser.execute("mobile: swipe", { direction: "up" });
    await wait(1_000);
  }
  throw new Error(`TestFlight에서 찾지 못했습니다: ${predicate}`);
}

async function tap(browser: Browser, predicate: string): Promise<void> {
  await (await findScrolling(browser, predicate)).click();
  await wait(testflightUi.settleMs);
}

async function tapInstallOnRow(browser: Browser, version: string): Promise<void> {
  const label = buildRowLabel(version);
  const display = version.split("+")[0];
  const row = await findScrolling(browser, label ? `type == "XCUIElementTypeStaticText" AND label == "${label}"` : `type == "XCUIElementTypeStaticText" AND label BEGINSWITH "${display}("`);
  const rowY = (await row.getLocation()).y;
  const placed: Array<{ button: WebdriverIO.Element; y: number }> = [];
  for (const button of await browser.$$(`-ios predicate string:type == "XCUIElementTypeButton" AND label == "설치"`).getElements()) {
    placed.push({ button, y: (await button.getLocation()).y });
  }
  const target = nearestByY(rowY, placed);
  if (!target) throw new Error(`TestFlight ${label ?? display} 줄에 「설치」 버튼이 없습니다. 이미 깔려 있을 수 있습니다.`);
  await target.button.click();
  await wait(testflightUi.settleMs);
  // 낮은 빌드는 「현재 버전을 대체」 확인 창이 뜬다. 없으면 그대로 설치가 시작된 것이다.
  await browser.acceptAlert().catch(() => undefined);
}

/**
 * TestFlight 앱을 Appium으로 조작해 dev 앱의 원하는 빌드를 깐다. 낮은 버전으로 내릴 때도 같다.
 * 경로: 앱 목록 「<devAppName>」(앱 설정 `install.testflightDevAppName`) → 「이전 빌드」 → 버전 묶음 → 빌드 줄 「설치」. 설치 완료는 호출하는 쪽이 버전으로 기다린다.
 * 한 기기에 Appium 세션은 하나뿐이라, 부르기 전에 앱 세션을 닫아야 한다(`resetIosSession`).
 */
export async function installFromTestflight(udid: string, version: string, devAppName: string | undefined, signing: IosSigning = {}): Promise<void> {
  if (!devAppName) throw new Error("앱 설정 install.testflightDevAppName이 없어 TestFlight에서 고를 앱을 모릅니다.");
  // 확인 창이 없을 때 acceptAlert가 남기는 오류 로그를 숨긴다(정상 흐름이다).
  const browser = await remote({ ...appiumConnection(), logLevel: "silent", capabilities: iosCapabilities(udid, testflightBundleId, signing) });
  try {
    // TestFlight는 마지막 화면을 기억한다. 늘 앱 목록에서 시작하도록 다시 띄운다.
    await browser.execute("mobile: terminateApp", { bundleId: testflightBundleId });
    await browser.execute("mobile: activateApp", { bundleId: testflightBundleId });
    await wait(testflightUi.settleMs);
    await tap(browser, `label CONTAINS "${devAppName}"`);
    await tap(browser, `type == "XCUIElementTypeButton" AND label BEGINSWITH "이전 빌드"`);
    await tap(browser, `type == "XCUIElementTypeButton" AND label BEGINSWITH "${versionGroupPrefix(version)}"`);
    await tapInstallOnRow(browser, version);
  } finally {
    await browser.deleteSession().catch(() => undefined);
  }
}

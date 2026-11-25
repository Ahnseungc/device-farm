import assert from "node:assert/strict";

import type { ScreenDriver } from "@device-farm/core/device/driver";

import { checkLayout } from "./check";

const facts = (blank: boolean) => JSON.stringify({ viewport: { width: 360, height: 800 }, pageOverflow: false, outside: [], clipped: [], overlaps: [], cutBottom: [], blank });

function driverOf(blanks: boolean[]): { driver: ScreenDriver; measured: () => number } {
  let count = 0;
  const driver = { evaluate: async () => facts(blanks[Math.min(count++, blanks.length - 1)]) } as unknown as ScreenDriver;
  return { driver, measured: () => count };
}
const blankOk = async (driver: ScreenDriver, path: string) => (await checkLayout(driver, path, () => {}, 1)).find((check) => check.id === "layout-blank")?.ok;

// 넘어가는 중이라 잠깐 비었으면 다시 잰다. 끝까지 비어 있으면 실패다
{
  const opening = driverOf([true, true, false]);
  assert.equal(await blankOk(opening.driver, "/cs/inquiry"), true);
  assert.equal(opening.measured(), 3);
  assert.equal(await blankOk(driverOf([true]).driver, "/cs/inquiry"), false);
  const shown = driverOf([false]);
  assert.equal(await blankOk(shown.driver, "/a"), true);
  assert.equal(shown.measured(), 1);
  // 비어 있는 게 정상인 화면은 다시 재지 않는다
  const bridge = driverOf([true]);
  assert.equal(await blankOk(bridge.driver, "/oauth-native-bridge"), undefined);
  assert.equal(bridge.measured(), 1);
}

console.log("layout check ok");

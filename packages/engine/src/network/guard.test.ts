import assert from "node:assert/strict";

import type { NetworkRecovery, ScreenDriver } from "@device-farm/core/device/driver";

import { sampleApp } from "@device-farm/core/config/sample-app";

import { withNetworkRecovery } from "./guard";
import { checkIdleDevices } from "./idle-watch";

/** 오류 화면을 흉내 낸 기기. broken이면 누르기가 실패하고, recoverNetwork가 fixable이면 고친다 */
function fakeDevice(state: { broken: boolean; fixable: boolean }) {
  const calls: string[] = [];
  const driver: ScreenDriver = {
    app: sampleApp,
    navigate: async (path) => {
      calls.push(`navigate ${path}`);
    },
    clickButton: async (name) => {
      calls.push(`click ${name}`);
      if (state.broken) throw new Error("Android 앱에서 웹 화면을 찾지 못했습니다.");
    },
    recoverNetwork: async (): Promise<NetworkRecovery> => {
      if (!state.broken) return { status: "none" };
      calls.push("reload");
      if (!state.fixable) return { status: "failed", code: "net::ERR_CONNECTION_TIMED_OUT" };
      state.broken = false;
      return { status: "recovered", code: "net::ERR_CONNECTION_TIMED_OUT" };
    },
    expectText: async () => undefined,
    currentPath: async () => "/",
    hasText: async () => false,
    screenshot: async () => Buffer.alloc(0),
    evaluate: async <T>() => null as T,
    close: async () => undefined,
  };
  return { driver, calls };
}

// 누르기 전에 오류 화면이면 다시 불러 고친 뒤 누른다
{
  const logs: string[] = [];
  const state = { broken: true, fixable: true };
  const { driver, calls } = fakeDevice(state);
  await withNetworkRecovery(driver, (message) => logs.push(message)).clickButton("홈", "link");
  assert.deepEqual(calls, ["reload", "click 홈"]);
  assert.deepEqual(logs, ["네트워크 오류 화면(net::ERR_CONNECTION_TIMED_OUT)을 다시 불러 고쳤습니다."]);
}

// 누르다 오류 화면이 뜨면 고치고 한 번 더 누른다
{
  const state = { broken: false, fixable: true };
  const { driver, calls } = fakeDevice(state);
  const inner = driver.clickButton;
  let first = true;
  driver.clickButton = async (name, role, match) => {
    if (first) {
      first = false;
      state.broken = true;
    }
    return inner(name, role, match);
  };
  await withNetworkRecovery(driver, () => undefined).clickButton("금 팔기");
  assert.deepEqual(calls, ["click 금 팔기", "reload", "click 금 팔기"]);
}

// 다시 불러도 안 풀리면 네트워크 오류로 실패한다(로그아웃으로 오해하지 않는다)
{
  const { driver } = fakeDevice({ broken: true, fixable: false });
  await assert.rejects(withNetworkRecovery(driver, () => undefined).navigate("/my"), /네트워크 오류\(net::ERR_CONNECTION_TIMED_OUT\)/);
}

// 오류 화면이 없으면 그대로
{
  const { driver, calls } = fakeDevice({ broken: false, fixable: true });
  await withNetworkRecovery(driver, () => undefined).navigate("/my");
  assert.deepEqual(calls, ["navigate /my"]);
}

// 쉬는 기기: 고치면 끝, 안 되면 앱을 다시 켠다. 점검이 돌면 아무것도 안 한다. 잠긴 기기는 건너뛴다
{
  const relaunched: string[] = [];
  const results: Record<string, NetworkRecovery | null> = {
    A: { status: "none" },
    B: { status: "recovered", code: "net::ERR_CONNECTION_TIMED_OUT" },
    C: { status: "failed", code: "net::ERR_CONNECTION_TIMED_OUT" },
    D: null,
  };
  const logs: string[] = [];
  const deps = {
    busy: () => false,
    idleDevices: async () => ["A", "B", "C", "D"],
    reload: async (id: string) => results[id],
    relaunch: async (id: string) => void relaunched.push(id),
    log: (message: string) => logs.push(message),
  };
  assert.deepEqual(await checkIdleDevices(deps), { A: "none", B: "recovered", C: "relaunched", D: "skipped" });
  assert.deepEqual(relaunched, ["C"]);
  assert.equal(logs.length, 2);
  assert.deepEqual(await checkIdleDevices({ ...deps, busy: () => true }), {});
}

console.log("network guard ok");

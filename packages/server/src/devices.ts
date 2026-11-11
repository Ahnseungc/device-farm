import type { ScreenDriver } from "@device-farm/core/device/driver";
import type { DeviceLocks } from "@device-farm/core/device/lock";
import { appIdFor, kindOfAppId, type AppConfig } from "@device-farm/core/config/app-config";
import type { Device, DeviceState } from "@device-farm/core/device/types";
import { openAndroidDriver } from "@device-farm/devices/android-driver";
import type { Exec } from "@device-farm/devices/exec";
import { installAndLaunch, launchArgs } from "@device-farm/devices/install";
import { versionMatches, waitForInstalledVersion } from "@device-farm/devices/install-source";
import { openIosDriver } from "@device-farm/devices/ios-driver";
import { getIosSession, resetIosSession } from "@device-farm/devices/ios-session";
import { installedAppVersion, listDevices } from "@device-farm/devices/registry";
import { installFromTestflight } from "@device-farm/devices/testflight";
import type { RunDeps } from "@device-farm/engine/run";

import { defaultBuildDeps, fetchBuild } from "./build/firebase";
import { webOrigin } from "./env";
import type { StreamHub } from "./streams";
import type { DeviceWithState } from "./types";

/** 격자 폴링(2초)이 adb·devicectl을 겹쳐 부르지 않게 (작성자 판단) */
export const deviceListCacheMs = 2_000;

/** 앱 id로 기기 드라이버를 연다. 웹 주소는 앱 id의 빌드 종류(dev·prod)를 따른다 */
export async function openDriver(app: AppConfig, device: Device, appId: string): Promise<ScreenDriver> {
  if (device.platform === "android") return openAndroidDriver(device.id, appId, webOrigin(app, kindOfAppId(app, appId)), app);
  return openIosDriver(await getIosSession(device.id, appId, app.ios), appId, app);
}

/** runDevices·runExplore가 쓰는 실기기 쪽 deps. */
export function createDeviceDeps(app: AppConfig, exec: Exec, hub: StreamHub) {
  const buildDeps = defaultBuildDeps(app.install);
  return {
    app,
    // ponytail: appVersion은 dev 앱 기준이다(탐색의 dev 판정과 격자 표시가 같은 값). 운영 앱 버전은 안 보인다.
    listDevices: () => listDevices(exec, app.appIds.dev, app.iosBundleIds?.dev),
    fetchBuild: (input) => fetchBuild(input, buildDeps),
    installAndLaunch: async (device, file, appId, run) => {
      const result = await installAndLaunch(device, file, appId, run);
      if (result.ok && device.platform === "ios") {
        // 앱을 다시 깔면 세션을 새로 연다. 다음 openDriver가 새 세션을 연다.
        await resetIosSession(device.id);
        hub.forgetIos(device.id);
      }
      return result;
    },
    waitForTestflight: async (device, kind, version) => {
      const appId = appIdFor(app, kind, device.platform);
      const readInstalled = () => installedAppVersion(exec, device, appId);
      if (!versionMatches(version, await readInstalled().catch(() => null))) {
        // 자동 업데이트는 최신 빌드로만 올린다. 다른(낮은) 빌드는 TestFlight 「이전 빌드」에서 직접 깐다.
        // 한 기기에 Appium 세션은 하나라 앱 세션을 먼저 닫는다. 실패하면 자동 업데이트를 기다리는 원래 방식으로 간다.
        await resetIosSession(device.id);
        hub.forgetIos(device.id);
        await installFromTestflight(device.id, version, app.install.testflightDevAppName, app.ios).catch((error: unknown) => console.log(`[farm] TestFlight 설치 실패, 자동 업데이트를 기다립니다: ${error instanceof Error ? error.message : String(error)}`));
      }
      const result = await waitForInstalledVersion({ requested: version, readInstalled });
      if (!result.ok) return result;
      // TestFlight가 앱을 바꿔 끼웠으니 세션을 새로 열고 앱을 띄운다.
      await resetIosSession(device.id);
      hub.forgetIos(device.id);
      const [command, args] = launchArgs(device, appId);
      await exec(command, args);
      return result;
    },
    openDriver: (device: Device, appId: string) => openDriver(app, device, appId),
  } satisfies Pick<RunDeps, "app" | "listDevices" | "fetchBuild" | "installAndLaunch" | "waitForTestflight" | "openDriver">;
}

function stateOf(locks: DeviceLocks, id: string): DeviceState {
  const owner = locks.ownerOf(id);
  if (owner?.kind === "bot") return "checking";
  if (owner?.kind === "user") return "controlling";
  return "idle";
}

/** 연결된 기기 + 한 번 본 뒤 빠진 기기(offline). 겹친 호출은 한 번만 돈다. */
export function createDeviceList(list: () => Promise<Device[]>, locks: DeviceLocks, now: () => number = Date.now) {
  const seen = new Map<string, Device>();
  let inFlight: Promise<Device[]> | null = null;
  let cached: { at: number; devices: Device[] } | null = null;

  async function connected(): Promise<Device[]> {
    if (cached && now() - cached.at < deviceListCacheMs) return cached.devices;
    inFlight ??= list().finally(() => {
      inFlight = null;
    });
    const devices = await inFlight;
    cached = { at: now(), devices };
    for (const device of devices) seen.set(device.id, device);
    return devices;
  }

  async function withState(): Promise<DeviceWithState[]> {
    const devices = await connected();
    const ids = new Set(devices.map((device) => device.id));
    const online = devices.map((device) => ({ ...device, state: stateOf(locks, device.id) }));
    const offline = [...seen.values()].filter((device) => !ids.has(device.id)).map((device) => ({ ...device, state: "offline" as const }));
    return [...online, ...offline];
  }

  return { connected, withState };
}

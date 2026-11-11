import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { Device } from "@device-farm/core/device/types";

import type { Exec } from "./exec";

type IosListing = { id: string; model: string; osVersion: string };

interface DevicectlDevice {
  hardwareProperties?: { platform?: string; udid?: string; marketingName?: string };
  deviceProperties?: { osVersionNumber?: string };
  connectionProperties?: { tunnelState?: string; transportType?: string };
}

interface DevicectlApp {
  bundleIdentifier?: string;
  version?: string;
  bundleVersion?: string;
}

/** `adb devices` 출력에서 상태가 `device`인 시리얼만. unauthorized·offline은 뺀다. */
export function parseAdbDevices(stdout: string): string[] {
  return stdout
    .split("\n")
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter((cells) => cells.length >= 2 && cells[1] === "device")
    .map((cells) => cells[0]);
}

/**
 * USB로 꽂은 아이폰. CoreDevice 터널은 명령을 한 번 보내야 열려서, 막 꽂은 기기는
 * `transportType: "wired"`인데 `tunnelState: "disconnected"`로 나온다(2026-10-26 iPhone 16 실측).
 * 그래서 유선이면 터널 상태와 관계없이 넣는다. 무선 페어링만 된 기기(`localNetwork`)는 뺀다.
 */
function isConnectedIphone(device: DevicectlDevice): boolean {
  if (device.hardwareProperties?.platform !== "iOS") return false;
  const connection = device.connectionProperties;
  return connection?.transportType === "wired" || connection?.tunnelState === "connected";
}

/** devicectl JSON에서 연결된 iOS 기기만. Apple Watch·꺼진 기기·무선 페어링만 된 기기는 뺀다. */
export function parseDevicectlList(json: string): IosListing[] {
  const parsed = JSON.parse(json) as { result?: { devices?: DevicectlDevice[] } };
  return (parsed.result?.devices ?? []).filter(isConnectedIphone).map((device) => ({
    id: device.hardwareProperties?.udid ?? "",
    model: device.hardwareProperties?.marketingName ?? "",
    osVersion: device.deviceProperties?.osVersionNumber ?? "",
  }));
}

/** devicectl은 JSON을 파일로만 쓴다(표준출력 `-` 안 됨). 임시 파일에 받아 읽고 지운다. */
async function devicectlJson(exec: Exec, args: readonly string[]): Promise<string> {
  const dir = mkdtempSync(path.join(tmpdir(), "devicectl-"));
  const file = path.join(dir, "out.json");
  try {
    await exec("xcrun", ["devicectl", ...args, "--json-output", file]);
    return readFileSync(file, "utf8");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** `dumpsys package`의 `versionName`. 앱이 없으면 그 줄이 없다. */
export function parseVersionName(stdout: string): string | null {
  return /versionName=(\S+)/.exec(stdout)?.[1] ?? null;
}

/** `versionName+versionCode` (예 `2.0.18+412`). 빌드 번호가 없으면 versionName만. */
export function parseAndroidAppVersion(stdout: string): string | null {
  const name = parseVersionName(stdout);
  const code = /versionCode=(\d+)/.exec(stdout)?.[1];
  return name && code ? `${name}+${code}` : name;
}

async function adbShell(exec: Exec, serial: string, args: readonly string[]): Promise<string> {
  return (await exec("adb", ["-s", serial, "shell", ...args])).trim();
}

async function androidDevice(exec: Exec, serial: string, appId: string): Promise<Device> {
  const model = await adbShell(exec, serial, ["getprop", "ro.product.model"]);
  const osVersion = await adbShell(exec, serial, ["getprop", "ro.build.version.release"]);
  const appVersion = parseAndroidAppVersion(await adbShell(exec, serial, ["dumpsys", "package", appId]));
  return { id: serial, platform: "android", model, osVersion, appVersion };
}

/** `version+bundleVersion` (예 `2.0.19+418`). 하나만 있으면 그것, 둘 다 없으면 null. */
export function parseDevicectlAppVersion(json: string, appId: string): string | null {
  const parsed = JSON.parse(json) as { result?: { apps?: DevicectlApp[] } };
  const app = (parsed.result?.apps ?? []).find((item) => item.bundleIdentifier === appId);
  if (app?.version && app.bundleVersion) return `${app.version}+${app.bundleVersion}`;
  return app?.version ?? app?.bundleVersion ?? null;
}

async function iosAppVersion(exec: Exec, udid: string, appId: string): Promise<string | null> {
  // `--include-all-apps`가 없으면 개발자가 직접 깐 앱만 나온다. Firebase·TestFlight·스토어로 받은 앱은
  // 빈 목록이 된다(2026-10-26 iPhone 16 실측). 미설치면 오류 없이 빈 목록, 버전은 `version`·`bundleVersion`.
  const json = await devicectlJson(exec, [
    "device",
    "info",
    "apps",
    "--device",
    udid,
    "--bundle-id",
    appId,
    "--include-all-apps",
  ]);
  return parseDevicectlAppVersion(json, appId);
}

async function listAndroid(exec: Exec, appId: string): Promise<Device[]> {
  const serials = parseAdbDevices(await exec("adb", ["devices"]));
  return Promise.all(serials.map((serial) => androidDevice(exec, serial, appId)));
}

async function listIos(exec: Exec, appId: string): Promise<Device[]> {
  const listings = parseDevicectlList(await devicectlJson(exec, ["list", "devices"]));
  return Promise.all(
    listings.map(async (listing) => ({
      ...listing,
      platform: "ios" as const,
      appVersion: await iosAppVersion(exec, listing.id, appId),
    })),
  );
}

/** 연결된 Android·iOS 기기. Android 먼저. */
/** 연결된 기기. 앱 버전은 `appId`(iOS는 `iosAppId`가 있으면 그것) 기준 */
export async function listDevices(exec: Exec, appId: string, iosAppId: string = appId): Promise<Device[]> {
  const [android, ios] = await Promise.all([listAndroid(exec, appId), listIos(exec, iosAppId)]);
  return [...android, ...ios];
}

/** 기기 하나의 설치된 앱 버전(`version+build`). TestFlight 설치 대기가 쓴다. */
export async function installedAppVersion(exec: Exec, device: Device, appId: string): Promise<string | null> {
  if (device.platform === "ios") return iosAppVersion(exec, device.id, appId);
  return parseAndroidAppVersion(await adbShell(exec, device.id, ["dumpsys", "package", appId]));
}

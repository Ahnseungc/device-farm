import { readdirSync } from "node:fs";
import path from "node:path";

import type { Device } from "@device-farm/core/device/types";

import type { Exec } from "./exec";

export type InstallResult = { ok: true } | { ok: false; message: string };

/** IPA를 풀어 둘 디렉터리. 캐시 파일 바로 옆. */
export function unpackedIpaDir(ipa: string): string {
  return `${ipa}.d`;
}

/** 풀어 둔 IPA의 `Payload/*.app`. 없으면 throw. */
export function ipaAppPath(ipa: string): string {
  const payload = path.join(unpackedIpaDir(ipa), "Payload");
  const app = readdirSync(payload).find((name) => name.endsWith(".app"));
  if (!app) throw new Error(`${payload} 에 .app이 없습니다.`);
  return path.join(payload, app);
}

function isIpa(file: string): boolean {
  return file.toLowerCase().endsWith(".ipa");
}

/** 덮어쓰기 설치. iOS IPA는 미리 풀어 둔 `.app`을 넘긴다(devicectl 도움말상 .app 번들, 작성자 판단). */
export function installArgs(device: Device, file: string): [string, string[]] {
  if (device.platform === "android") return ["adb", ["-s", device.id, "install", "-r", file]];
  const bundle = isIpa(file) ? ipaAppPath(file) : file;
  return ["xcrun", ["devicectl", "device", "install", "app", "--device", device.id, bundle]];
}

export function launchArgs(device: Device, appId: string): [string, string[]] {
  if (device.platform === "android") return ["adb", ["-s", device.id, "shell", "monkey", "-p", appId, "1"]];
  return ["xcrun", ["devicectl", "device", "process", "launch", "--device", device.id, appId]];
}

async function unpackIpa(file: string, exec: Exec): Promise<void> {
  // 실기기 확인: devicectl이 IPA를 그대로 받으면 이 단계를 뺀다
  await exec("unzip", ["-q", "-o", file, "-d", unpackedIpaDir(file)]);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 설치 후 앱(`appId`)을 연다. 어느 단계든 실패하면 `{ ok: false, message }` (stderr 첫 줄). */
export async function installAndLaunch(device: Device, file: string, appId: string, exec: Exec): Promise<InstallResult> {
  try {
    if (device.platform === "ios" && isIpa(file)) await unpackIpa(file, exec);
    await exec(...installArgs(device, file));
    await exec(...launchArgs(device, appId));
    return { ok: true };
  } catch (error) {
    return { ok: false, message: errorMessage(error) };
  }
}

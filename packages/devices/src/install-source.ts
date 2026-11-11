import { setTimeout as wait } from "node:timers/promises";

import type { InstallConfig, InstallSourceKind } from "@device-farm/core/config/app-config";
import type { BuildKind, Platform } from "@device-farm/core/device/types";

import type { InstallResult } from "./install";

/**
 * 빌드를 어디서 기기에 올리나.
 * - firebase: 디바이스팜이 Firebase에서 받아 덮어써 설치한다.
 * - testflight: 버전이 다르면 디바이스팜이 TestFlight 앱 「이전 빌드」에서 그 빌드를 직접 깐다(`testflight.ts`, 낮은 버전도).
 *   그다음 설치된 버전이 맞을 때까지 기다린다. 직접 설치가 실패하면 자동 업데이트를 기다린다.
 *   iOS dev를 App Store 서명으로만 올리는 앱(Ad-hoc 없음)이 쓴다. 그 빌드는 WebView 디버깅이 켜져 있어야 한다.
 * 플랫폼·빌드마다 앱 설정 `install.sources`로 정한다. 비면 firebase.
 */
export type InstallSource = InstallSourceKind;

export function installSourceOf(install: Pick<InstallConfig, "sources">, platform: Platform, kind: BuildKind): InstallSource {
  return install.sources?.[platform]?.[kind] ?? "firebase";
}

/** TestFlight 자동 업데이트를 기다리는 최대 시간과 확인 간격 (작성자 판단). */
export const testflightWaitMs = 30 * 60_000;
export const testflightPollMs = 15_000;

/** `2.0.20`이면 표시 버전만, `2.0.20+419`면 빌드 번호까지 같아야 한다. */
export function versionMatches(requested: string, installed: string | null): boolean {
  if (!installed) return false;
  if (requested.includes("+")) return installed === requested;
  return installed.split("+")[0] === requested;
}

export function testflightTimeoutMessage(requested: string, installed: string | null, waitMs = testflightWaitMs): string {
  const minutes = Math.round(waitMs / 60_000);
  return `TestFlight에서 ${requested}이 ${minutes}분 안에 설치되지 않았습니다. TestFlight 앱의 자동 업데이트를 켜 주세요. (설치된 버전: ${installed ?? "없음"})`;
}

export interface WaitForVersionInput {
  requested: string;
  readInstalled: () => Promise<string | null>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  waitMs?: number;
  pollMs?: number;
}

/** 설치된 버전이 요청과 맞을 때까지 기다린다. 읽기 오류는 그 회차만 건너뛴다(기기가 잠깐 끊길 수 있다). */
export async function waitForInstalledVersion(input: WaitForVersionInput): Promise<InstallResult> {
  const now = input.now ?? Date.now;
  const sleep = input.sleep ?? ((ms: number) => wait(ms).then(() => undefined));
  const waitMs = input.waitMs ?? testflightWaitMs;
  const deadline = now() + waitMs;
  let installed: string | null = null;
  for (;;) {
    installed = await input.readInstalled().catch(() => installed);
    if (versionMatches(input.requested, installed)) return { ok: true };
    if (now() >= deadline) return { ok: false, message: testflightTimeoutMessage(input.requested, installed, waitMs) };
    await sleep(input.pollMs ?? testflightPollMs);
  }
}

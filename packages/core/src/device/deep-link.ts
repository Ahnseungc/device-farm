import type { AppConfig } from "../config/app-config";

/**
 * 시나리오 경로 → 앱 경로형 스킴 딥링크.
 * `/` → `<scheme>://<homeHost>`, `/benefit/attendance?x=1` → `<scheme>://benefit/attendance?x=1`.
 * 앱이 이 스킴을 받아 같은 웹 경로를 WebView로 연다고 본다 — 실제 사용자 진입(푸시·링크)과 같은 경로다.
 */
export function deepLinkUrl(path: string, deepLink: AppConfig["deepLink"]): string {
  if (!deepLink.scheme) throw new Error("앱 설정에 deepLink.scheme이 없습니다. farm.config.ts에 딥링크 스킴을 넣어 주세요.");
  const trimmed = path.replace(/^\/+/, "");
  if (trimmed === "" || trimmed.startsWith("?")) return `${deepLink.scheme}://${deepLink.homeHost}${trimmed}`;
  return `${deepLink.scheme}://${trimmed}`;
}

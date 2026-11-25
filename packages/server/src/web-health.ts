import type { AppConfig } from "@device-farm/core/config/app-config";
import type { BuildKind } from "@device-farm/core/device/types";

import { apiOrigin, webOrigin } from "./env";

/** 앱 웹 서버 확인 시간 제한 (작성자 판단) */
export const webHealthTimeoutMs = 10_000;

/** 한 주소가 정상 응답하는지. 5xx·접속 실패면 이유, 아니면 null. 리다이렉트(307)·404는 따라가지 않고 정상으로 본다 */
async function probe(url: string, fetchImpl: typeof fetch): Promise<string | null> {
  try {
    const response = await fetchImpl(url, { redirect: "manual", signal: AbortSignal.timeout(webHealthTimeoutMs) });
    return response.status >= 500 ? `HTTP ${response.status}` : null;
  } catch (error) {
    const reason = error instanceof Error ? (error.name === "TimeoutError" ? `${webHealthTimeoutMs / 1000}초 안에 응답 없음` : error.message) : String(error);
    return `접속 실패: ${reason}`;
  }
}

/**
 * 앱 WebView가 여는 웹 서버와 (dev면) API 서버가 정상 응답하는지 호스트에서 본다.
 * 문제가 있으면 이유, 둘 다 정상이면 null.
 * API를 같이 보는 까닭: 웹은 열리지만 API가 죽으면 화면이 로딩에서 멈춰 플로우가 「링크를 눌렀지만 …로 가지 않았습니다」로 실패한다.
 * 웹 서버만 보면 이 실패가 앱 실패로 남는다.
 */
export async function webHealth(app: Pick<AppConfig, "web" | "apiOrigin">, kind: BuildKind, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  const api = kind === "dev" ? apiOrigin(app) : "";
  const [web, apiProblem] = await Promise.all([probe(webOrigin(app, kind), fetchImpl), api ? probe(api, fetchImpl) : Promise.resolve(null)]);
  if (web) return web;
  return apiProblem ? `API ${apiProblem}` : null;
}

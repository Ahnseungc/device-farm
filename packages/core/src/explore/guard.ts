import type { AppConfig } from "../config/app-config";
import { decideRequest, readMethods } from "./policy";
import type { Allowlist, BlockReason, GuardRules } from "./policy";

export type BlockedRequest = { method: string; path: string; reason: BlockReason; at: number };

/** Playwright `Route`에서 가드가 쓰는 부분만. 실제 Route가 그대로 들어간다(guard.test.ts에서 타입 확인). */
export interface GuardRoute {
  request(): { method(): string; url(): string };
  abort(errorCode?: string): Promise<void>;
  continue(): Promise<void>;
}

export type GuardHandler = (route: GuardRoute) => Promise<void>;

/** Playwright `Page`에서 가드가 쓰는 부분만. */
export interface GuardPage {
  route(url: string, handler: GuardHandler): Promise<unknown>;
  unroute(url: string, handler?: GuardHandler): Promise<void>;
}

const allRequests = "**/*";
const blockedErrorCode = "blockedbyclient";

function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** 문서 이동 기준. 웹 주소·API 주소(앱 설정 `apiOrigin`)가 아니면 외부(결제창, 본인인증, 은행 등). 못 읽는 주소도 외부로 본다. */
export function isExternal(url: string, webOrigin: string, apiOrigin?: string): boolean {
  const target = originOf(url);
  if (target === null || target === "null") return true;
  const internal = [originOf(webOrigin), originOf(apiOrigin)].filter((origin) => origin !== null);
  return !internal.includes(target);
}

/**
 * 허용 목록과 비교할 경로. 내부(웹·API) 요청은 pathname, 외부 요청은 `https://host/path`.
 * 외부 쓰기도 판단 대상이다(결제창 등). 외부를 허용하려면 사람이 전체 주소로 allow를 적는다.
 */
export function guardPath(url: string, webOrigin: string, apiOrigin?: string): string {
  const parsed = new URL(url);
  if (isExternal(url, webOrigin, apiOrigin)) return `${parsed.origin}${parsed.pathname}`;
  return parsed.pathname;
}

/** 가드가 보는 앱 설정: 웹·API 주소와 금지 규칙 */
export interface GuardTarget extends GuardRules {
  webOrigin: string;
  apiOrigin?: string;
}

export function guardTargetOf(app: Pick<AppConfig, "apiOrigin" | "guard">, webOrigin: string): GuardTarget {
  return { webOrigin, apiOrigin: app.apiOrigin || undefined, forbiddenApiPatterns: app.guard.forbiddenApiPatterns, pushTokenRequests: app.guard.pushTokenRequests };
}

function decide(route: GuardRoute, target: GuardTarget, allowlist: Allowlist): BlockedRequest | null {
  const request = route.request();
  const method = request.method().toUpperCase();
  try {
    const path = guardPath(request.url(), target.webOrigin, target.apiOrigin);
    const decision = decideRequest(method, path, allowlist, target);
    return decision.allow ? null : { method, path, reason: decision.reason, at: Date.now() };
  } catch {
    // 주소를 못 읽으면 판단할 수 없다. 읽기만 통과시키고 쓰기는 막는다(fail closed).
    if ((readMethods as readonly string[]).includes(method)) return null;
    return { method, path: request.url(), reason: "unknown", at: Date.now() };
  }
}

/** Android WebView 페이지의 쓰기 요청을 가로채 허용 목록 밖이면 abort. 해제 함수를 돌려준다. */
export async function guardAndroidPage(
  page: GuardPage,
  target: GuardTarget,
  allowlist: Allowlist,
  onBlocked: (request: BlockedRequest) => void,
): Promise<() => Promise<void>> {
  const handler: GuardHandler = async (route) => {
    const blocked = decide(route, target, allowlist);
    if (!blocked) {
      await route.continue();
      return;
    }
    await route.abort(blockedErrorCode);
    onBlocked(blocked);
  };
  await page.route(allRequests, handler);
  return () => page.unroute(allRequests, handler);
}

import type { SessionStore } from "./sessions";

/**
 * 디바이스팜 관문 판단. 공용 사내망에 열리므로 IP가 아니라 팀 비밀번호 세션이 문지기다.
 * 프록시가 없으므로 접속 주소는 소켓 주소만 믿고 `X-Forwarded-*`·`Tailscale-*` 같은 헤더는 보지 않는다.
 */
export const localUser = "local";
export const sessionCookie = "farm_session";
export const loginPath = "/login";
export const loginApiPath = "/api/login";
export const logoutApiPath = "/api/logout";

export const loginRequiredMessage = "로그인이 필요합니다.";
export const crossOriginMessage = "다른 사이트에서 온 요청은 받지 않습니다.";

const loopbackAddresses = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const safeMethods = new Set(["GET", "HEAD"]);

export type Access = { ok: true; user: string } | { ok: false; status: 401 | 403; message: string };

export interface AccessInput {
  /** `req.socket.remoteAddress` */
  remoteAddress?: string;
  /** Cookie 헤더 원문 */
  cookie?: string;
  method: string;
  /** Origin 헤더 */
  origin?: string;
  url: string;
}

export interface AccessOptions {
  /** `FARM_PUBLIC_ORIGIN`. 없으면 루프백 밖 GET이 아닌 요청은 전부 403 */
  publicOrigin?: string;
  now?: Date;
}

export function isLoopback(address: string | undefined): boolean {
  return Boolean(address && loopbackAddresses.has(address));
}

/** `::ffff:192.168.0.5` → `192.168.0.5` */
export function displayAddress(address: string | undefined): string {
  if (!address) return "unknown";
  return address.startsWith("::ffff:") ? address.slice("::ffff:".length) : address;
}

export function teamUser(address: string | undefined): string {
  return `team@${displayAddress(address)}`;
}

export function pathnameOf(url: string): string {
  const end = url.search(/[?#]/);
  return end === -1 ? url : url.slice(0, end);
}

/** `FARM_PUBLIC_ORIGIN`을 `scheme://host[:port]`로 맞춘다. 틀리면 undefined */
export function normalizeOrigin(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  try {
    return new URL(value.trim()).origin;
  } catch {
    return undefined;
  }
}

export function publicOriginFromEnv(): string | undefined {
  return normalizeOrigin(process.env.FARM_PUBLIC_ORIGIN);
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return undefined;
}

export function isLoginRoute(method: string, url: string): boolean {
  const pathname = pathnameOf(url);
  return (safeMethods.has(method) && pathname === loginPath) || (method === "POST" && pathname === loginApiPath);
}

function originAllowed(method: string, origin: string | undefined, publicOrigin: string | undefined): boolean {
  if (safeMethods.has(method)) return true;
  return Boolean(publicOrigin && origin && normalizeOrigin(origin) === publicOrigin);
}

/** 표의 다섯 줄을 차례로 본다. 처음 걸리는 줄이 결과다. */
export function decideAccess(input: AccessInput, sessions: SessionStore, options: AccessOptions = {}): Access {
  const method = input.method.toUpperCase();
  const user = isLoopback(input.remoteAddress) ? localUser : teamUser(input.remoteAddress);
  // 1. 로그인 경로. POST도 Origin은 본다
  if (isLoginRoute(method, input.url)) {
    if (!isLoopback(input.remoteAddress) && !originAllowed(method, input.origin, options.publicOrigin)) return { ok: false, status: 403, message: crossOriginMessage };
    return { ok: true, user };
  }
  // 2. 호스트 자신(호스트 브라우저·SSH CLI)
  if (isLoopback(input.remoteAddress)) return { ok: true, user: localUser };
  // 3. 세션
  const id = readCookie(input.cookie, sessionCookie);
  if (!id || !sessions.valid(id, options.now)) return { ok: false, status: 401, message: loginRequiredMessage };
  // 4. 다른 사이트에서 온 쓰기 요청
  if (!originAllowed(method, input.origin, options.publicOrigin)) return { ok: false, status: 403, message: crossOriginMessage };
  // 5. 통과
  return { ok: true, user };
}

/** 로그인 뒤 돌아갈 경로. `/`로 시작하고 `//`·`/\`로 시작하지 않는 것만(열린 리다이렉트 막기). */
export function safeNext(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return "/";
  if (pathnameOf(value) === loginPath) return "/";
  return value;
}

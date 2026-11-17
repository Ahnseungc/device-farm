import type { IncomingMessage, ServerResponse } from "node:http";

import {
  decideAccess,
  displayAddress,
  isLoopback,
  localUser,
  loginApiPath,
  loginPath,
  logoutApiPath,
  pathnameOf,
  publicOriginFromEnv,
  readCookie,
  sessionCookie,
  type Access,
} from "./access";
import { loginPageHtml } from "./login-page";
import { validHashFormat, verifyPassword } from "./password";
import { LoginLimiter, loginFailLimit } from "./rate-limit";
import { sessionTtlMs, type SessionStore } from "./sessions";

/**  */
export const wrongPasswordMessage = "비밀번호가 맞지 않습니다.";
export const lockedMessage = "로그인 시도가 많아 15분 동안 막혔습니다.";
export const missingHashLog = "[farm] FARM_PASSWORD_HASH가 없어 사내망 접속을 막습니다.";
const maxLoginBodyBytes = 1024;
const dayMs = 24 * 60 * 60 * 1000;

type Next = (error?: unknown) => void;

const users = new WeakMap<IncomingMessage, string>();

/** 관문이 정한 사용자 이름. 관문을 안 거친 요청(테스트에서 미들웨어를 직접 부를 때)은 `local`. */
export function requestUser(req: IncomingMessage): string {
  return users.get(req) ?? localUser;
}

export function setRequestUser(req: IncomingMessage, user: string): void {
  users.set(req, user);
}

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function send(res: ServerResponse, status: number, type: string, body: string, extra: Record<string, string> = {}): void {
  res.statusCode = status;
  res.setHeader("content-type", type);
  res.setHeader("cache-control", "no-store");
  for (const [name, value] of Object.entries(extra)) res.setHeader(name, value);
  res.end(body);
}

const sendJson = (res: ServerResponse, status: number, body: unknown, extra?: Record<string, string>) =>
  send(res, status, "application/json; charset=utf-8", JSON.stringify(body), extra);

function sessionCookieValue(id: string): string {
  return `${sessionCookie}=${id}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${Math.floor(sessionTtlMs / 1000)}`;
}

const expiredCookie = `${sessionCookie}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;

async function readPassword(req: IncomingMessage): Promise<string | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += buffer.length;
    if (size > maxLoginBodyBytes) return null;
    chunks.push(buffer);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
    if (typeof body === "object" && body !== null && "password" in body && typeof body.password === "string") return body.password;
  } catch {
    return null;
  }
  return null;
}

export interface AuthGateOptions {
  sessions: SessionStore;
  /** 없으면 `FARM_PASSWORD_HASH` */
  passwordHash?: () => string | undefined;
  /** 없으면 `FARM_PUBLIC_ORIGIN` */
  publicOrigin?: () => string | undefined;
  limiter?: LoginLimiter;
  now?: () => Date;
  log?: (line: string) => void;
}

export interface AuthGate {
  /** 모든 요청의 첫 미들웨어. 로그인 화면·API도 여기서 답한다 */
  middleware(req: IncomingMessage, res: ServerResponse, next: Next): void;
  /** WebSocket 업그레이드 판단(스트림·Vite HMR 모두) */
  upgrade(req: IncomingMessage): Access;
  /** 서버 시작 때: 비밀번호 바뀜 확인·만료 세션 정리, 하루 한 번 정리. 멈추는 함수를 돌려준다 */
  start(): () => void;
}

export function createAuthGate(options: AuthGateOptions): AuthGate {
  const { sessions } = options;
  const passwordHash = options.passwordHash ?? (() => process.env.FARM_PASSWORD_HASH?.trim() || undefined);
  const publicOrigin = options.publicOrigin ?? publicOriginFromEnv;
  const limiter = options.limiter ?? new LoginLimiter();
  const now = options.now ?? (() => new Date());
  const log = options.log ?? ((line: string) => console.log(line));

  function decide(req: IncomingMessage): Access {
    return decideAccess(
      { remoteAddress: req.socket.remoteAddress, cookie: header(req, "cookie"), method: req.method ?? "GET", origin: header(req, "origin"), url: req.url ?? "/" },
      sessions,
      { publicOrigin: publicOrigin(), now: now() },
    );
  }

  async function login(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const address = req.socket.remoteAddress;
    const ip = displayAddress(address);
    const at = now().getTime();
    const waitMs = limiter.lockedFor(ip, at);
    if (waitMs > 0) return sendJson(res, 429, { error: lockedMessage }, { "retry-after": String(Math.ceil(waitMs / 1000)) });
    const password = await readPassword(req);
    if (password !== null && (await verifyPassword(password, passwordHash()))) {
      limiter.succeed(ip);
      const id = sessions.create(ip, now());
      res.statusCode = 204;
      res.setHeader("cache-control", "no-store");
      res.setHeader("set-cookie", sessionCookieValue(id));
      res.end();
      return;
    }
    const { count, locked } = limiter.fail(ip, at);
    log(`[auth] 로그인 실패 ${ip} (${count}/${loginFailLimit})`);
    if (locked) {
      log(`[auth] 로그인 잠금 ${ip} 15분`);
      return sendJson(res, 429, { error: lockedMessage }, { "retry-after": String(Math.ceil(limiter.lockedFor(ip, at) / 1000)) });
    }
    sendJson(res, 401, { error: wrongPasswordMessage });
  }

  function logout(req: IncomingMessage, res: ServerResponse): void {
    const id = readCookie(header(req, "cookie"), sessionCookie);
    if (id) sessions.remove(id);
    res.statusCode = 204;
    res.setHeader("cache-control", "no-store");
    res.setHeader("set-cookie", expiredCookie);
    res.end();
  }

  function deny(req: IncomingMessage, res: ServerResponse, access: Extract<Access, { ok: false }>): void {
    const url = req.url ?? "/";
    const method = (req.method ?? "GET").toUpperCase();
    if (pathnameOf(url).startsWith("/api/")) return sendJson(res, access.status, { error: access.message });
    if (access.status === 401 && (method === "GET" || method === "HEAD")) {
      res.statusCode = 302;
      res.setHeader("cache-control", "no-store");
      res.setHeader("location", `${loginPath}?next=${encodeURIComponent(url)}`);
      res.end();
      return;
    }
    send(res, access.status, "text/plain; charset=utf-8", `디바이스팜: ${access.message}`);
  }

  return {
    middleware(req, res, next) {
      const access = decide(req);
      if (!access.ok) return deny(req, res, access);
      setRequestUser(req, access.user);
      const method = (req.method ?? "GET").toUpperCase();
      const pathname = pathnameOf(req.url ?? "/");
      if (pathname === loginPath && (method === "GET" || method === "HEAD")) return send(res, 200, "text/html; charset=utf-8", loginPageHtml);
      if (pathname === loginApiPath && method === "POST") {
        login(req, res).catch(next);
        return;
      }
      if (pathname === logoutApiPath && method === "POST") return logout(req, res);
      next();
    },
    upgrade(req) {
      const access = decide(req);
      if (access.ok) setRequestUser(req, access.user);
      return access;
    },
    start() {
      const hash = passwordHash();
      if (!hash || !validHashFormat(hash)) log(missingHashLog);
      else if (sessions.resetIfPasswordChanged(hash)) log("[auth] 비밀번호가 바뀌어 세션을 모두 지웠습니다.");
      sessions.prune(now());
      const timer = setInterval(() => sessions.prune(now()), dayMs);
      timer.unref();
      return () => clearInterval(timer);
    },
  };
}

/** 업그레이드를 거절할 때 소켓에 쓰는 응답 */
export function upgradeRefusal(access: Extract<Access, { ok: false }>): string {
  return `HTTP/1.1 ${access.status} ${access.status === 401 ? "Unauthorized" : "Forbidden"}\r\nConnection: close\r\n\r\n`;
}

export { isLoopback };

import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";

import { all, openFarmDb } from "@device-farm/engine/db/farm-db";

import { sessionCookie } from "./access";
import { createAuthGate, lockedMessage, requestUser, upgradeRefusal, wrongPasswordMessage } from "./http";
import { hashPassword, validHashFormat, verifyPassword } from "./password";
import { LoginLimiter } from "./rate-limit";
import { dbSessionStore } from "./sessions";

const password = "correct horse battery staple";
const hash = await hashPassword(password);

// 비밀번호
assert.match(hash, /^scrypt\$32768\$8\$1\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
assert.equal(validHashFormat(hash), true);
assert.equal(await verifyPassword(password, hash), true);
assert.equal(await verifyPassword(`${password}!`, hash), false);
assert.equal(await verifyPassword(password, undefined), false);
for (const broken of ["", "plain", "scrypt$3$8$1$a$b", `scrypt$${2 ** 30}$8$1$aaaaaaaaaaaaaaaaaaaaaa$${"a".repeat(86)}`, hash.slice(0, -4)]) {
  assert.equal(await verifyPassword(password, broken), false, broken);
  assert.equal(validHashFormat(broken), false, broken);
}

// 잠금: 5번 틀리면 15분
{
  const limiter = new LoginLimiter();
  const t0 = 1_000_000;
  for (let n = 1; n <= 4; n += 1) assert.deepEqual(limiter.fail("ip", t0 + n), { count: n, locked: false });
  assert.deepEqual(limiter.fail("ip", t0 + 5), { count: 5, locked: true });
  assert.ok(limiter.lockedFor("ip", t0 + 6) > 14 * 60 * 1000);
  assert.equal(limiter.lockedFor("other", t0 + 6), 0);
  assert.equal(limiter.lockedFor("ip", t0 + 5 + 15 * 60 * 1000), 0);
  // 10분이 지난 실패는 세지 않는다
  const slow = new LoginLimiter();
  for (let n = 0; n < 6; n += 1) assert.equal(slow.fail("ip", n * 11 * 60 * 1000).locked, false);
}

// 세션: DB에는 id 해시만, 비밀번호가 바뀌면 전부 지운다
{
  const db = openFarmDb(":memory:");
  const sessions = dbSessionStore(db);
  const id = sessions.create("192.168.13.20");
  assert.equal(sessions.valid(id), true);
  const stored = all<{ id_hash: string }>(db, "SELECT id_hash FROM farm_sessions");
  assert.equal(stored.length, 1);
  assert.notEqual(stored[0].id_hash, id);
  assert.equal(JSON.stringify(all(db, "SELECT * FROM farm_sessions")).includes(id), false, "원문이 DB에 없다");
  assert.equal(sessions.resetIfPasswordChanged(hash), false, "처음은 바뀜이 아니다");
  assert.equal(sessions.valid(id), false, "처음 적을 때도 세션은 비운다");
  const again = sessions.create("192.168.13.20");
  assert.equal(sessions.resetIfPasswordChanged(hash), false);
  assert.equal(sessions.valid(again), true, "같은 비밀번호면 유지");
  assert.equal(sessions.resetIfPasswordChanged(await hashPassword("another long password")), true);
  assert.equal(sessions.valid(again), false, "비밀번호가 바뀌면 기존 세션 401");
  const old = sessions.create("ip", new Date(Date.now() - 8 * 24 * 60 * 60 * 1000));
  assert.equal(sessions.valid(old), false);
  assert.equal(sessions.prune(), 1);
  sessions.remove(old);
  db.close();
}

// HTTP 관문
interface Reply {
  status: number;
  headers: Record<string, string>;
  body: string;
  next: boolean;
}

const office = "192.168.13.20";
const publicOrigin = "https://farm-host.local:5173";

async function call(gate: ReturnType<typeof createAuthGate>, method: string, url: string, options: { body?: unknown; headers?: Record<string, string>; address?: string } = {}): Promise<Reply> {
  const req = Object.assign(Readable.from(options.body === undefined ? [] : [Buffer.from(typeof options.body === "string" ? options.body : JSON.stringify(options.body))]), {
    method,
    url,
    headers: options.headers ?? {},
    socket: { remoteAddress: options.address ?? office },
  }) as unknown as IncomingMessage;
  return new Promise((resolve, reject) => {
    const reply: Reply = { status: 200, headers: {}, body: "", next: false };
    const fake: { statusCode: number; setHeader(name: string, value: string): void; end(body?: string): void } = {
      statusCode: 200,
      setHeader(name, value) {
        reply.headers[name.toLowerCase()] = value;
      },
      end(body) {
        reply.status = fake.statusCode;
        reply.body = body ?? "";
        resolve(reply);
      },
    };
    const res = fake as unknown as ServerResponse;
    gate.middleware(req, res, (error?: unknown) => {
      if (error) return reject(error);
      reply.next = true;
      reply.body = requestUser(req);
      resolve(reply);
    });
  });
}

{
  const db = openFarmDb(":memory:");
  let now = new Date("2026-11-16T10:00:00Z");
  const logs: string[] = [];
  const gate = createAuthGate({ sessions: dbSessionStore(db), passwordHash: () => hash, publicOrigin: () => publicOrigin, now: () => now, log: (line) => logs.push(line) });
  const stop = gate.start();
  const sameSite = { origin: publicOrigin };

  // 로그인 전: API 401 JSON, 화면 302, 로그인 화면은 열린다
  const api = await call(gate, "GET", "/api/devices");
  assert.equal(api.status, 401);
  assert.deepEqual(JSON.parse(api.body), { error: "로그인이 필요합니다." });
  assert.equal(api.headers["cache-control"], "no-store");
  const page = await call(gate, "GET", "/results?run=1");
  assert.equal(page.status, 302);
  assert.equal(page.headers.location, "/login?next=%2Fresults%3Frun%3D1");
  const loginPage = await call(gate, "GET", "/login");
  assert.equal(loginPage.status, 200);
  assert.match(loginPage.body, /디바이스팜 로그인/);
  assert.equal((await call(gate, "GET", "/src/main.tsx")).status, 302, "소스 파일도 관문 뒤");
  // 헤더로 속일 수 없다
  assert.equal((await call(gate, "GET", "/api/devices", { headers: { "x-forwarded-for": "127.0.0.1", "tailscale-user-login": "a@example.com" } })).status, 401);

  // 틀린 비밀번호 401, 다른 사이트에서 온 로그인 403
  const wrong = await call(gate, "POST", "/api/login", { body: { password: "nope" }, headers: sameSite });
  assert.equal(wrong.status, 401);
  assert.deepEqual(JSON.parse(wrong.body), { error: wrongPasswordMessage });
  assert.equal((await call(gate, "POST", "/api/login", { body: { password }, headers: { origin: "https://evil.example" } })).status, 403);
  assert.equal((await call(gate, "POST", "/api/login", { body: "x".repeat(2000), headers: sameSite })).status, 401, "1KB 넘는 본문");

  // 맞는 비밀번호 204 + 쿠키
  const ok = await call(gate, "POST", "/api/login", { body: { password }, headers: sameSite });
  assert.equal(ok.status, 204);
  const setCookie = ok.headers["set-cookie"];
  assert.match(setCookie, /^farm_session=[A-Za-z0-9_-]{43}; HttpOnly; Secure; SameSite=Strict; Path=\/; Max-Age=604800$/);
  const cookie = setCookie.split(";")[0];
  assert.ok(!logs.some((line) => line.includes(password)), "비밀번호가 로그에 없다");

  // 로그인 뒤 통과, 사용자 이름 team@<ip>
  const after = await call(gate, "GET", "/api/devices", { headers: { cookie } });
  assert.equal(after.next, true);
  assert.equal(after.body, `team@${office}`);
  assert.equal((await call(gate, "POST", "/api/devices/A/lock", { headers: { cookie, ...sameSite } })).next, true);
  assert.equal((await call(gate, "POST", "/api/devices/A/lock", { headers: { cookie, origin: "https://evil.example" } })).status, 403, "CSRF");

  // WebSocket 업그레이드
  const upgradeReq = (headers: Record<string, string>, address = office) => ({ method: "GET", url: "/api/devices/A/stream", headers, socket: { remoteAddress: address } }) as unknown as IncomingMessage;
  const refused = gate.upgrade(upgradeReq({}));
  assert.equal(refused.ok, false);
  if (!refused.ok) assert.equal(upgradeRefusal(refused), "HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
  assert.equal(gate.upgrade({ ...upgradeReq({}), url: "/?token=vite-hmr" } as unknown as IncomingMessage).ok, false, "Vite HMR 업그레이드도 401");
  assert.deepEqual(gate.upgrade(upgradeReq({ cookie })), { ok: true, user: `team@${office}` });
  assert.deepEqual(gate.upgrade(upgradeReq({}, "127.0.0.1")), { ok: true, user: "local" });

  // 호스트 자신은 로그인 없이
  const local = await call(gate, "POST", "/api/devices/run", { address: "127.0.0.1" });
  assert.equal(local.next, true);
  assert.equal(local.body, "local");

  // 로그아웃: 세션 삭제·쿠키 만료
  const logout = await call(gate, "POST", "/api/logout", { headers: { cookie, ...sameSite } });
  assert.equal(logout.status, 204);
  assert.match(logout.headers["set-cookie"], /^farm_session=; .*Max-Age=0$/);
  assert.equal((await call(gate, "GET", "/api/devices", { headers: { cookie } })).status, 401);

  // 잠금: 5번 틀리면 6번째는 맞아도 429, 15분 뒤 풀림
  const attacker = "192.168.13.99";
  for (let n = 0; n < 4; n += 1) assert.equal((await call(gate, "POST", "/api/login", { body: { password: "x" }, headers: sameSite, address: attacker })).status, 401);
  const fifth = await call(gate, "POST", "/api/login", { body: { password: "x" }, headers: sameSite, address: attacker });
  assert.equal(fifth.status, 429);
  assert.deepEqual(JSON.parse(fifth.body), { error: lockedMessage });
  const locked = await call(gate, "POST", "/api/login", { body: { password }, headers: sameSite, address: attacker });
  assert.equal(locked.status, 429);
  assert.equal(locked.headers["retry-after"], "900");
  assert.ok(logs.includes(`[auth] 로그인 잠금 ${attacker} 15분`));
  assert.equal((await call(gate, "POST", "/api/login", { body: { password }, headers: sameSite })).status, 204, "다른 IP는 잠기지 않는다");
  now = new Date(now.getTime() + 15 * 60 * 1000);
  assert.equal((await call(gate, "POST", "/api/login", { body: { password }, headers: sameSite, address: attacker })).status, 204);

  stop();
  db.close();
}

// 비밀번호 해시가 없으면 시작 로그를 남기고 아무도 로그인하지 못한다
{
  const db = openFarmDb(":memory:");
  const logs: string[] = [];
  const gate = createAuthGate({ sessions: dbSessionStore(db), passwordHash: () => undefined, publicOrigin: () => publicOrigin, log: (line) => logs.push(line) });
  gate.start()();
  assert.ok(logs.includes("[farm] FARM_PASSWORD_HASH가 없어 사내망 접속을 막습니다."));
  assert.equal((await call(gate, "POST", "/api/login", { body: { password }, headers: { origin: publicOrigin } })).status, 401);
  db.close();
}

console.log(`auth ok (${sessionCookie})`);

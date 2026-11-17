import assert from "node:assert/strict";

import { openFarmDb } from "@device-farm/engine/db/farm-db";

import { crossOriginMessage, decideAccess, loginRequiredMessage, readCookie, safeNext, sessionCookie, type AccessInput } from "./access";
import { dbSessionStore } from "./sessions";

const db = openFarmDb(":memory:");
const sessions = dbSessionStore(db);
const publicOrigin = "https://farm-host.local:5173";
const options = { publicOrigin };
const office = "192.168.13.20";
const id = sessions.create(office);
const cookie = `other=1; ${sessionCookie}=${id}`;

const request = (extra: Partial<AccessInput>): AccessInput => ({ remoteAddress: office, method: "GET", url: "/", ...extra });

// 1. 로그인 경로는 로그인 전에도 열린다. POST는 Origin을 본다
assert.equal(decideAccess(request({ url: "/login?next=%2F" }), sessions, options).ok, true);
assert.equal(decideAccess(request({ method: "POST", url: "/api/login", origin: publicOrigin }), sessions, options).ok, true);
assert.deepEqual(decideAccess(request({ method: "POST", url: "/api/login", origin: "https://evil.example" }), sessions, options), {
  ok: false,
  status: 403,
  message: crossOriginMessage,
});
assert.equal(decideAccess(request({ method: "POST", url: "/api/login" }), sessions, options).ok, false, "Origin 없음");
// 로그인 화면은 GET만, 로그인 API는 POST만
assert.equal(decideAccess(request({ method: "POST", url: "/login" }), sessions, options).ok, false);
assert.equal(decideAccess(request({ url: "/api/login" }), sessions, options).ok, false);

// 2. 호스트 자신은 쿠키·Origin 없이 local
for (const address of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
  assert.deepEqual(decideAccess(request({ remoteAddress: address, method: "POST", url: "/api/devices/run" }), sessions, options), { ok: true, user: "local" });
}

// 3. 세션 없음 → 401. 헤더로 속일 수 없다(소켓 주소만 믿는다)
const unauthorized = { ok: false, status: 401, message: loginRequiredMessage };
assert.deepEqual(decideAccess(request({ url: "/api/devices" }), sessions, options), unauthorized);
assert.deepEqual(decideAccess(request({ url: "/api/devices", cookie: `${sessionCookie}=nope` }), sessions, options), unauthorized);
assert.deepEqual(decideAccess(request({ url: "/api/devices", cookie: `${sessionCookie}=${"A".repeat(43)}` }), sessions, options), unauthorized);
assert.deepEqual(decideAccess(request({ url: "/src/main.tsx" }), sessions, options), unauthorized, "Vite 소스 파일도 관문 뒤");
// 만료된 세션
const later = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000);
assert.deepEqual(decideAccess(request({ cookie }), sessions, { ...options, now: later }), unauthorized);

// 4. 쿠키가 있어도 다른 사이트에서 온 쓰기 요청은 403
assert.deepEqual(decideAccess(request({ method: "POST", url: "/api/devices/A/lock", cookie, origin: "https://evil.example" }), sessions, options), {
  ok: false,
  status: 403,
  message: crossOriginMessage,
});
assert.equal(decideAccess(request({ method: "POST", url: "/api/devices/A/lock", cookie }), sessions, options).ok, false, "Origin 없는 POST");
// FARM_PUBLIC_ORIGIN이 없으면 바깥 쓰기는 모두 403
assert.equal(decideAccess(request({ method: "POST", url: "/api/devices/A/lock", cookie, origin: publicOrigin }), sessions, {}).ok, false);

// 5. 통과. 사용자 이름은 team@<IP>
assert.deepEqual(decideAccess(request({ url: "/api/devices", cookie }), sessions, options), { ok: true, user: `team@${office}` });
assert.deepEqual(decideAccess(request({ remoteAddress: `::ffff:${office}`, method: "DELETE", url: "/api/devices/A/lock", cookie, origin: `${publicOrigin}/` }), sessions, options), {
  ok: true,
  user: `team@${office}`,
});

// 쿠키 읽기
assert.equal(readCookie("a=1; farm_session=xyz ; b=2", sessionCookie), "xyz");
assert.equal(readCookie("farm_sessionx=1", sessionCookie), undefined);
assert.equal(readCookie(undefined, sessionCookie), undefined);

// 로그인 뒤 돌아갈 곳: 열린 리다이렉트 막기
assert.equal(safeNext("/results?run=1"), "/results?run=1");
for (const bad of ["//evil.example", "https://evil.example", "/\\evil.example", "evil", "", null, undefined, "/login?next=/"]) assert.equal(safeNext(bad), "/", String(bad));

db.close();
console.log("access ok");

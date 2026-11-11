import assert from "node:assert/strict";

import { allowedDomains, decideAccess } from "./access";

assert.deepEqual(allowedDomains(undefined), []);
assert.deepEqual(allowedDomains(undefined, ["Example.com"]), ["example.com"]);
const domains = allowedDomains(" example.com, @Example.org ");
assert.deepEqual(domains, ["example.com", "example.org"]);
// 환경 변수가 앱 설정보다 먼저다
assert.deepEqual(allowedDomains("example.com", ["other.com"]), ["example.com"]);

const viaServe = (login?: string) => ({
  remoteAddress: "127.0.0.1",
  headers: { "x-forwarded-for": "100.64.0.7", ...(login ? { "tailscale-user-login": login } : {}) },
});

// tailnet에서 허용 도메인 계정
assert.deepEqual(decideAccess(viaServe("qa@example.com"), domains), { ok: true, user: "qa@example.com" });
// 대소문자 무시
assert.equal(decideAccess(viaServe("Someone@EXAMPLE.COM"), domains).ok, true);
// 다른 도메인, 비슷한 도메인은 403
assert.equal(decideAccess(viaServe("friend@gmail.com"), domains).ok, false);
assert.deepEqual(decideAccess(viaServe("evil@notexample.com"), ["example.com"]), {
  ok: false,
  status: 403,
  message: "evil@notexample.com 계정은 디바이스팜을 쓸 수 없습니다. example.com 계정으로 접속해 주세요.",
});
assert.equal(decideAccess(viaServe("example.com"), domains).ok, false);
// 허용 도메인이 없으면 계정으로는 못 들어온다
assert.equal(decideAccess(viaServe("qa@example.com"), []).ok, false);
// serve를 거쳤는데 계정이 없으면(태그 기기 등) 401
const anonymous = decideAccess(viaServe(), domains);
assert.equal(anonymous.ok === false && anonymous.status, 401);
// 호스트 맥에서 직접(브라우저·SSH CLI)
assert.deepEqual(decideAccess({ remoteAddress: "127.0.0.1", headers: {} }, domains), { ok: true, user: "local" });
assert.equal(decideAccess({ remoteAddress: "::1", headers: {} }, []).ok, true);
// 루프백이 아닌 곳에서 계정 없이
assert.equal(decideAccess({ remoteAddress: "192.168.0.10", headers: {} }, domains).ok, false);

console.log("access ok");

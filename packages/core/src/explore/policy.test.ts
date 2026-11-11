import assert from "node:assert/strict";

import { defineAppConfig } from "../config/app-config";
import { sampleApp } from "../config/sample-app";
import { addMissingAsDeny, decideRequest as decideWith, matchTemplate, parseAllowlist } from "./policy";
import type { Allowlist } from "./policy";

// 예시 앱 설정의 가드 규칙(기본 금지 경로 + 푸시 토큰 저장)
const decideRequest = (method: string, path: string, list: Allowlist) => decideWith(method, path, list, sampleApp.guard);

const allowlist: Allowlist = {
  entries: [
    { method: "POST", path: "/api/v1/orders", status: "allow", note: "실수로 allow" },
    { method: "PUT", path: "/users/{id}/alarm", status: "allow", note: "" },
    { method: "POST", path: "/api/v1/alarm/settings", status: "deny", note: "" },
  ],
};

// 금지 경로가 allow로 적혀도 forbidden
assert.deepEqual(decideRequest("POST", "/api/v1/orders", allowlist), { allow: false, reason: "forbidden" });
for (const path of [
  "/api/v1/payments/confirm",
  "/api/v1/sell-requests",
  "/api/v1/points/transfer",
  "/api/v1/withdrawal",
  "/api/v1/users/me/bank-account",
  "/api/v1/users/resign",
  "/api/v1/delete-account",
  "/api/v1/delivery-requests",
  "/api/v1/%6Frders", // 인코딩 우회
]) {
  assert.deepEqual(decideRequest("post", path, { entries: [] }), { allow: false, reason: "forbidden" }, path);
}

// 템플릿 매칭
assert.deepEqual(decideRequest("put", "/users/123/alarm", allowlist), { allow: true });
assert.deepEqual(decideRequest("PUT", "/users/123/alarm?x=1", allowlist), { allow: true });
assert.equal(matchTemplate("/users/{id}/alarm", "/users/123/alarm"), true);
assert.equal(matchTemplate("/users/{id}/alarm", "/users/1/2/alarm"), false);
assert.equal(matchTemplate("/users/{id}/alarm", "/users/123/alarm/extra"), false);
assert.equal(matchTemplate("/users/{id}/alarm", "/x/users/123/alarm"), false);
assert.equal(matchTemplate("/a.b", "/aXb"), false);
// 메서드가 다르면 allow 항목에 안 맞는다
assert.deepEqual(decideRequest("DELETE", "/users/123/alarm", allowlist), { allow: false, reason: "unknown" });

// deny / unknown / GET
assert.deepEqual(decideRequest("POST", "/api/v1/alarm/settings", allowlist), { allow: false, reason: "not-allowed" });
assert.deepEqual(decideRequest("POST", "/api/v1/unlisted", allowlist), { allow: false, reason: "unknown" });
assert.deepEqual(decideRequest("GET", "/api/v1/orders", allowlist), { allow: true });
assert.deepEqual(decideRequest("head", "/api/v1/orders", allowlist), { allow: true });
assert.deepEqual(decideRequest("TRACE", "/api/v1/unlisted", allowlist), { allow: false, reason: "unknown" });

// explore-allowlist 재실행: 기존 allow를 덮지 않음
const first = addMissingAsDeny(allowlist, [
  { method: "put", path: "/users/{id}/alarm" },
  { method: "post", path: "/api/v1/new" },
  { method: "POST", path: "/api/v1/new" },
  { method: "get", path: "/api/v1/read" },
]);
assert.equal(first.added, 1);
assert.equal(first.allowlist.entries.find((entry) => entry.path === "/users/{id}/alarm")?.status, "allow");
assert.deepEqual(first.allowlist.entries.at(-1), { method: "POST", path: "/api/v1/new", status: "deny", note: "" });
const second = addMissingAsDeny(first.allowlist, [{ method: "post", path: "/api/v1/new" }]);
assert.equal(second.added, 0);
assert.deepEqual(second.allowlist, first.allowlist);
assert.equal(allowlist.entries.length, 3); // 입력을 바꾸지 않는다

// 모양 검증
assert.throws(() => parseAllowlist({}));
assert.throws(() => parseAllowlist({ entries: [{ method: "GET", path: "/a", status: "allow" }] }));
assert.throws(() => parseAllowlist({ entries: [{ method: "POST", path: "/a", status: "maybe" }] }));
assert.throws(() => parseAllowlist({ entries: [{ method: "POST", path: "a", status: "deny" }] }));
assert.deepEqual(parseAllowlist({ entries: [{ method: "POST", path: "/a", status: "deny" }] }).entries[0].note, "");

console.log("policy ok");

// 앱 설정의 pushTokenRequests는 허용 목록이 비어도 통과한다. 금지어(accounts 등)보다 먼저 본다
const empty = { entries: [] };
assert.deepEqual(decideRequest("POST", "/v1/users/42/push-token", empty), { allow: true });
// 같은 경로라도 메서드가 다르면 그대로 막는다
assert.equal(decideRequest("DELETE", "/v1/users/42/push-token", empty).allow, false);
// 외부 주소도 전체 주소로 적으면 통과시킨다. 금지어(accounts)에 걸리는 주소도 먼저 본다
const withFirebase = defineAppConfig({
  ...sampleApp,
  guard: { pushTokenRequests: [{ method: "POST", path: "https://identitytoolkit.googleapis.com/v1/accounts:lookup" }] },
});
assert.deepEqual(decideWith("POST", "https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=x", empty, withFirebase.guard), { allow: true });
assert.equal(decideWith("POST", "https://identitytoolkit.googleapis.com/v1/accounts:delete", empty, withFirebase.guard).allow, false);
// 앱이 금지 경로를 더할 수 있다
const extra = defineAppConfig({ ...sampleApp, guard: { extraForbiddenApiPatterns: [/coupon/i] } });
assert.deepEqual(decideWith("POST", "/v1/coupon/use", { entries: [{ method: "POST", path: "/v1/coupon/use", status: "allow", note: "" }] }, extra.guard), { allow: false, reason: "forbidden" });

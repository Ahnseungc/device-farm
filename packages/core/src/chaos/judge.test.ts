import assert from "node:assert/strict";

import type { Issue } from "../explore/probe";
import { dedupeErrors, judgeIssues } from "./judge";

const issue = (kind: Issue["kind"], message = ""): Issue => ({ kind, message });
const calm = { sinceRelaunchMs: 60_000, guardBlocked: false };

// 앱 오류·크래시·로그인 이탈은 오류, 레이아웃은 경고
{
  const result = judgeIssues([issue("app-error"), issue("crash"), issue("login-redirect"), issue("overflow")], calm);
  assert.deepEqual(result.errors.map((item) => item.kind), ["app-error", "crash", "login-redirect"]);
  assert.deepEqual(result.warnings.map((item) => item.kind), ["overflow"]);
}

// 가드가 끊은 요청의 콘솔 문구는 언제나 경고
assert.equal(judgeIssues([issue("console", "Failed to load resource: net::ERR_BLOCKED_BY_CLIENT.Inspector")], calm).errors.length, 0);
assert.equal(judgeIssues([issue("console", "Uncaught TypeError: x is undefined")], calm).errors.length, 1);

// 이 스텝에서 가드가 막았으면 콘솔·네트워크 오류는 경고(Firebase 인증·FCM 실패 등). 앱 오류는 그대로 오류
{
  const result = judgeIssues([issue("console", "Firebase 로그인 실패"), issue("network", "GET 500 /a"), issue("app-error")], { sinceRelaunchMs: 60_000, guardBlocked: true });
  assert.deepEqual(result.errors.map((item) => item.kind), ["app-error"]);
  assert.equal(result.warnings.length, 2);
}

// 재시작 직후 빈 화면은 로딩
assert.equal(judgeIssues([issue("blank")], { sinceRelaunchMs: 1_000, guardBlocked: false }).errors.length, 0);
assert.equal(judgeIssues([issue("blank")], calm).errors.length, 1);

// 같은 오류는 실행에서 한 번만 센다(광고 배너 404가 화면마다 잡혔다)
{
  const seen = new Set<string>();
  const banner = issue("network", "GET 404 https://dev/a/hZMQ%22%20target");
  const first = dedupeErrors({ errors: [banner], warnings: [] }, seen);
  const second = dedupeErrors({ errors: [banner, issue("app-error", "Application error")], warnings: [] }, seen);
  assert.equal(first.errors.length, 1);
  assert.deepEqual(second.errors.map((item) => item.kind), ["app-error"]);
  assert.equal(second.warnings.length, 1);
}

console.log("chaos judge ok");

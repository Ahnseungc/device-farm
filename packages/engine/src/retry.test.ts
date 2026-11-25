import assert from "node:assert/strict";

import { classify, settleRetry, shouldRetry } from "./retry";

const infra = { status: "failed", message: "WebDriverError: A session is either terminated or not started" } as const;
const app = { status: "failed", message: "/x 화면이 15초 안에 그려지지 않았습니다." } as const;

// 확정 표 
assert.deepEqual(settleRetry(app, { status: "passed" }), { status: "passed", message: "다시 돌려 통과 (첫 시도: /x 화면이 15초 안에 그려지지 않았습니다.)", from: "second" });
assert.deepEqual(settleRetry(infra, infra), { status: "inconclusive", message: infra.message, from: "second" });
assert.deepEqual(settleRetry(infra, app), { ...app, from: "second" });
assert.deepEqual(settleRetry(app, app), { ...app, from: "second" });
assert.deepEqual(settleRetry(app, infra), { ...app, from: "first" });
assert.deepEqual(settleRetry(app, { status: "login_required" }), { status: "login_required", from: "second" });

// 다시 돌리지 않는 것
assert.equal(shouldRetry({ status: "failed", message: "기준 화면과 다릅니다." }, { retryable: true }), false);
assert.equal(shouldRetry({ status: "failed", message: "기준 화면과 크기가 다릅니다." }, { retryable: true }), false);
assert.equal(shouldRetry({ status: "failed", message: "플로우가 10분 안에 끝나지 않아 멈추고 다음으로 넘어갔습니다." }, { retryable: true }), false);
assert.equal(shouldRetry(app, { retryable: false }), false);
assert.equal(shouldRetry({ status: "candidate" }, { retryable: true }), false);
assert.equal(shouldRetry({ status: "login_required" }, { retryable: true }), false);
assert.equal(shouldRetry(app, { retryable: true }), true);
assert.equal(shouldRetry(infra, { retryable: true }), true);

// 판별만
assert.deepEqual(classify(infra), { status: "inconclusive", message: infra.message });
assert.deepEqual(classify({ status: "failed", message: "플로우가 10분 안에 끝나지 않아 …" }), { status: "inconclusive", message: "플로우가 10분 안에 끝나지 않아 …" });
assert.deepEqual(classify(app), app);

console.log("retry ok");

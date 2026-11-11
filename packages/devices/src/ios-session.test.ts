import assert from "node:assert/strict";

import { isDeadSessionError } from "./ios-session";

// 다른 프로세스가 같은 기기에 세션을 열어 기존 세션이 사라졌을 때 Appium이 주는 문구들
assert.equal(isDeadSessionError(new Error("invalid session id: A session is either terminated or not started")), true);
assert.equal(isDeadSessionError(new Error("The session with id '6BB3' does not exist")), true);
assert.equal(isDeadSessionError(new Error("connect ECONNREFUSED 127.0.0.1:4723")), true);
// 2026-10-26 실측: WDA가 다시 뜬 뒤 입력이 받은 오류
assert.equal(isDeadSessionError(new Error('Could not proxy command to the remote server. Original error: socket hang up when running "window/rect"')), true);
// 화면에 요소가 없는 것 같은 일반 오류는 세션을 다시 열 이유가 아니다
assert.equal(isDeadSessionError(new Error("no such element: Unable to locate element")), false);

console.log("ios-session ok");

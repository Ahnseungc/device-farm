import assert from "node:assert/strict";

import { mismatchMessage, passwordProblem, tooShortMessage } from "./farm-password";

assert.equal(passwordProblem("short", "short"), tooShortMessage);
assert.equal(passwordProblem("a".repeat(7), "a".repeat(7)), tooShortMessage);
assert.equal(tooShortMessage, "비밀번호는 8자 이상이어야 합니다.");
assert.equal(passwordProblem("a".repeat(8), "b".repeat(8)), mismatchMessage);
assert.equal(passwordProblem("a".repeat(8), "a".repeat(8)), null);

console.log("farm-password ok");

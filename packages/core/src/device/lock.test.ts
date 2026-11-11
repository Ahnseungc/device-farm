import assert from "node:assert/strict";

import { controlIdleMs, DeviceLocks, type LockOwner } from "./lock";

let clock = 0;
const locks = new DeviceLocks(() => clock);
const bot: LockOwner = { kind: "bot", runId: "run-1" };
const user: LockOwner = { kind: "user", user: "qa-user" };

assert.equal(locks.acquire("A", bot), true);
assert.equal(locks.acquire("A", user), false);

assert.equal(locks.acquire("B", user), true);
assert.equal(locks.acquire("B", bot), false);

locks.release("A", user);
assert.deepEqual(locks.ownerOf("A"), bot);

clock = controlIdleMs - 1;
locks.touch("B");
clock += controlIdleMs;
assert.deepEqual(locks.ownerOf("B"), user);
clock += 2;
assert.equal(locks.ownerOf("B"), null);
assert.equal(locks.acquire("B", bot), true);

clock += controlIdleMs * 10;
assert.deepEqual(locks.ownerOf("A"), bot);
locks.release("A", bot);
assert.equal(locks.ownerOf("A"), null);

let later = 0;
const idle = new DeviceLocks(() => later);
idle.acquire("C", user);
later = controlIdleMs + 1;
assert.equal(idle.ownerOf("C"), null);
assert.equal(idle.acquire("C", bot), true);

console.log("lock ok");

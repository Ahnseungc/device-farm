import assert from "node:assert/strict";

import { FrameRing, LogRing, logWindowMs } from "./ring";

let clock = 0;
const ring = new LogRing(logWindowMs, () => clock);
ring.push({ source: "console", text: "old" });
clock = 31_000;
ring.push({ source: "network", text: "Bearer abc.def 010-1234-5678" });
assert.equal(ring.around(clock).some((entry) => entry.text === "old"), false);
const saved = ring.around(clock).map((entry) => entry.text).join(" ");
assert.equal(saved.includes("abc.def"), false);
assert.equal(saved.includes("010-1234-5678"), false);
assert.equal(ring.since(31_000).length, 1);

const frames = new FrameRing(30_000);
for (let second = 0; second <= 31; second += 1) frames.push(Buffer.from([second]), second * 1000, second % 2 === 0);
assert.equal(frames.frames()[0].key, true);
assert.ok(frames.frames()[0].at >= 1000);

console.log("ring ok");

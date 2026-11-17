import assert from "node:assert/strict";

import { nightlyDecision, nightlySeed, nightlySlots } from "./schedule";

const [flows, bot] = nightlySlots;
const at = (text: string) => new Date(text);

// 03:00 전이면 어제 03:00 칸 — 어제 처리했으면 기다린다
assert.deepEqual(nightlyDecision(flows, at("2026-11-12T03:00:00").toISOString(), at("2026-11-13T02:59:00")), { action: "wait" });
// 03:05, 아직 처리 안 함 → 돈다
const due = nightlyDecision(flows, at("2026-11-12T03:00:00").toISOString(), at("2026-11-13T03:05:00"));
assert.equal(due.action, "run");
assert.equal(due.action === "run" && due.scheduledAt.getTime(), at("2026-11-13T03:00:00").getTime());
// 처리한 뒤에는 기다린다
assert.deepEqual(nightlyDecision(flows, at("2026-11-13T03:00:00").toISOString(), at("2026-11-13T04:00:00")), { action: "wait" });
// 서버가 낮에 켜졌으면 그날은 건너뛴다(창 5시간)
assert.equal(nightlyDecision(flows, null, at("2026-11-13T10:00:00")).action, "skip");
assert.equal(nightlyDecision(bot, null, at("2026-11-13T08:29:00")).action, "run");
// 봇 시드는 날짜
assert.equal(nightlySeed(at("2026-11-13T03:30:00")), 20261113);

console.log("nightly schedule ok");

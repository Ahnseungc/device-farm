import assert from "node:assert/strict";

import { nightlyDecision, nightlySeed, nightlySlots } from "./schedule";

const [regular, bot] = nightlySlots;
const at = (text: string) => new Date(text);
const local = (decision: ReturnType<typeof nightlyDecision>) => (decision.action === "wait" ? "wait" : `${decision.action} ${decision.scheduledAt.toTimeString().slice(0, 5)}`);

// 정기 점검: 3시간마다. 자정부터 21시까지
assert.equal(local(nightlyDecision(regular, null, at("2026-11-24T00:01:00"))), "run 00:00");
assert.equal(local(nightlyDecision(regular, null, at("2026-11-24T18:05:00"))), "run 18:00");
assert.equal(local(nightlyDecision(regular, null, at("2026-11-24T23:59:00"))), "skip 21:00");
// 처리한 칸은 다음 칸까지 기다린다. 다음 칸이 오면 돈다
assert.equal(local(nightlyDecision(regular, at("2026-11-24T18:00:00").toISOString(), at("2026-11-24T20:59:00"))), "wait");
assert.equal(local(nightlyDecision(regular, at("2026-11-24T18:00:00").toISOString(), at("2026-11-24T21:00:00"))), "run 21:00");
assert.equal(local(nightlyDecision(regular, at("2026-11-24T21:00:00").toISOString(), at("2026-11-25T00:00:00"))), "run 00:00");
// 2시간 넘게 늦으면 그 칸은 건너뛴다
assert.equal(local(nightlyDecision(regular, at("2026-11-24T12:00:00").toISOString(), at("2026-11-24T17:30:00"))), "skip 15:00");

// 봇 점검: 하루 한 번 03:30, 창 5시간
assert.deepEqual(nightlyDecision(bot, at("2026-11-12T03:30:00").toISOString(), at("2026-11-13T03:29:00")), { action: "wait" });
assert.equal(local(nightlyDecision(bot, at("2026-11-12T03:30:00").toISOString(), at("2026-11-13T03:35:00"))), "run 03:30");
assert.equal(nightlyDecision(bot, null, at("2026-11-13T08:29:00")).action, "run");
assert.equal(nightlyDecision(bot, null, at("2026-11-13T10:00:00")).action, "skip");
// 봇 시드는 날짜
assert.equal(nightlySeed(at("2026-11-13T03:30:00")), 20261113);

console.log("nightly schedule ok");

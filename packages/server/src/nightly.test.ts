import assert from "node:assert/strict";

import type { NightlyKind } from "@device-farm/core/nightly/schedule";
import type { NightlyRecord } from "@device-farm/engine/nightly-store";

import { startNightlyChecks, type NightlyStart } from "./nightly";

const store = new Map<NightlyKind, NightlyRecord>();
const logs: string[] = [];
let clock = new Date("2026-11-13T03:05:00");
let botBusy = true;
const started: string[] = [];

const watch = startNightlyChecks({
  now: () => clock,
  read: (kind) => store.get(kind) ?? null,
  write: (kind, record) => store.set(kind, record),
  log: (message) => logs.push(message),
  start: (slot): NightlyStart => {
    if (slot.kind === "bot" && botBusy) return { started: false, busy: "이미 기기 점검 중입니다." };
    started.push(slot.kind);
    return { started: true, note: `${slot.kind}-run` };
  },
});
watch.stop();

// 03:05: 플로우만 예정 시각이 지났다 → 돈다. 봇(03:30)은 어제 칸인데 어제 창은 지났으니 건너뜀으로 남는다
assert.deepEqual(started, ["flows"]);
assert.equal(store.get("flows")?.result, "started");
assert.equal(store.get("bot")?.result, "skipped");

// 03:35: 봇 칸인데 플로우 점검이 아직 돌아 바쁘다 → 기다린다(기록 안 바뀜), 이유는 한 번만 로그
clock = new Date("2026-11-13T03:35:00");
watch.tick();
watch.tick();
assert.equal(store.get("bot")?.scheduledAt, new Date("2026-11-12T03:30:00").toISOString());
assert.equal(logs.filter((line) => line.includes("대기")).length, 1);

// 03:40: 비었다 → 봇이 돈다. 같은 칸은 다시 돌지 않는다
botBusy = false;
clock = new Date("2026-11-13T03:40:00");
watch.tick();
watch.tick();
assert.deepEqual(started, ["flows", "bot"]);
assert.equal(store.get("bot")?.note, "bot-run");

// 다음 날 09:00에 처음 켜졌으면 둘 다 건너뛰고, 바빴던 이유가 없으면 「서버가 꺼져 있었음」
clock = new Date("2026-11-14T09:00:00");
watch.tick();
assert.equal(store.get("flows")?.result, "skipped");
assert.match(store.get("flows")?.note ?? "", /꺼져/);

console.log("nightly ok");

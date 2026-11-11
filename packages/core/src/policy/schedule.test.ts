import assert from "node:assert/strict";

import { isPolicyCheckDue, lastScheduledAt, nextScheduledAt } from "./schedule";

// 로컬 시간으로 만든다(서버 시간대와 상관없이 같은 결과)
const at = (day: number, hour: number, minute = 0) => new Date(2026, 10, day, hour, minute);

// 오늘 2시 전이면 어제 2시, 지나면 오늘 2시
assert.equal(lastScheduledAt(at(11, 1, 59)).getTime(), at(10, 2).getTime());
assert.equal(lastScheduledAt(at(11, 2, 0)).getTime(), at(11, 2).getTime());
assert.equal(nextScheduledAt(at(11, 14)).getTime(), at(12, 2).getTime());

// 확인 기록이 없거나 최근 예정 시각보다 앞이면 돈다
assert.equal(isPolicyCheckDue(null, at(11, 14)), true);
assert.equal(isPolicyCheckDue(at(11, 1).toISOString(), at(11, 14)), true);
assert.equal(isPolicyCheckDue(at(11, 3).toISOString(), at(11, 14)), false);
// 어제 밤에 확인했고 아직 오늘 2시 전이면 안 돈다
assert.equal(isPolicyCheckDue(at(10, 23).toISOString(), at(11, 1)), false);

console.log("policy schedule ok");

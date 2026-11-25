import assert from "node:assert/strict";

import type { DeviceScreen } from "@device-farm/core/device/types";

import { recheckSummary } from "./recheck";

const screen = (status: DeviceScreen["status"], message?: string): DeviceScreen => ({ scenario: "플로우 점검 · f", status, message });

assert.deepEqual(recheckSummary([screen("passed"), screen("passed")]), { passed: true, note: "플로우 2개 통과" });
assert.deepEqual(recheckSummary([screen("passed"), screen("failed", "2단계 실패")]), { passed: false, note: "플로우 2개 중 1개 실패: 2단계 실패" });
// 점검 못 함은 통과가 아니다 — 확인 안 된 수정이 통과로 보고되지 않게(최종 리뷰)
assert.deepEqual(recheckSummary([screen("passed"), screen("inconclusive", "WebDriverError")]), { passed: false, note: "플로우 2개 중 점검 못 함 1개(기기·연결)" });
assert.deepEqual(recheckSummary([]), { passed: false, note: "돌린 플로우가 없어요(연결된 기기가 없을 수 있어요)." });

console.log("recheck ok");

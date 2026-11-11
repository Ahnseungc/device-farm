import assert from "node:assert/strict";

import type { DeviceOutcome, DeviceRun } from "@device-farm/core/device/types";
import type { ExploreRun } from "@device-farm/core/explore/actions";

import {
  changedLines,
  exploreExitCode,
  formatExploreSummary,
  formatOutcome,
  isExploreFinished,
  runExitCode,
  summarizeExplore,
} from "./format";
import type { PrintedState } from "./format";

const deviceA = { id: "a", platform: "android", model: "기기 A", osVersion: "14", appVersion: "2.1.5" } as const;
const deviceB = { id: "b", platform: "ios", model: "", osVersion: "18", appVersion: "2.1.5" } as const;

const passed: DeviceOutcome = {
  device: deviceA,
  status: "passed",
  screens: [
    { scenario: "홈", status: "passed" },
    { scenario: "출석체크", status: "passed" },
  ],
};
const failed: DeviceOutcome = {
  device: deviceB,
  status: "failed",
  screens: [
    { scenario: "홈", status: "passed" },
    { scenario: "출석체크", status: "failed", message: "기준 화면과 다릅니다" },
  ],
};

assert.deepEqual(formatOutcome(passed), ["[기기 A] Android 14 · 설치 완료", "PASS 2/2 화면"]);
assert.deepEqual(formatOutcome(failed), ["[b] iOS 18 · 설치 완료", "FAIL 출석체크 · 기준 화면과 다릅니다"]);
assert.deepEqual(formatOutcome({ ...passed, status: "running", screens: [] }), ["[기기 A] Android 14 · 점검 중"]);

const run: DeviceRun = {
  runId: "r1",
  kind: "prod",
  version: "2.1.5",
  trigger: "manual",
  startedAt: "2026-10-23T00:00:00.000Z",
  finishedAt: null,
  outcomes: [{ ...passed, status: "running", screens: [] }],
};
const printed: PrintedState = new Map();
assert.equal(changedLines(run, printed).length, 1);
assert.equal(changedLines(run, printed).length, 0);
const next: DeviceRun = { ...run, outcomes: [passed, failed] };
assert.deepEqual(changedLines(next, printed), [...formatOutcome(passed), ...formatOutcome(failed)]);
assert.equal(changedLines(next, printed).length, 0);

assert.equal(runExitCode(next), 1);
assert.equal(runExitCode({ ...run, outcomes: [passed] }), 0);
assert.equal(runExitCode({ ...run, outcomes: [] }), 1);
assert.equal(runExitCode({ ...run, outcomes: [{ ...passed, status: "install_failed" }, { ...passed, status: "offline" }] }), 0);

function exploreRun(overrides: Partial<ExploreRun>): ExploreRun {
  return {
    runId: "e1",
    deviceId: "a",
    startedAt: "2026-10-23T00:00:00.000Z",
    finishedAt: "2026-10-23T00:01:00.000Z",
    paths: [],
    issues: [],
    blocked: [],
    cleanPathIds: [],
    replayFailures: [],
    ...overrides,
  };
}

const blockedOnly = exploreRun({ blocked: [{ method: "POST", path: "/x", reason: "not-allowed", at: 0, pathId: "p" }] });
const withIssue = exploreRun({
  deviceId: "b",
  issues: [{ kind: "overflow", message: "가로 넘침", pathId: "p", screenshot: "", logDir: "" }],
});
assert.equal(formatExploreSummary(summarizeExplore([blockedOnly, withIssue])), "오류 1개 · 차단 1개");
assert.equal(exploreExitCode([blockedOnly]), 0);
assert.equal(exploreExitCode([blockedOnly, withIssue]), 1);
assert.equal(isExploreFinished([]), false);
assert.equal(isExploreFinished([blockedOnly, exploreRun({ finishedAt: null })]), false);
assert.equal(isExploreFinished([blockedOnly, withIssue]), true);

console.log("format ok");

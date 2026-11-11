import assert from "node:assert/strict";

import { installSourceOf, testflightTimeoutMessage, versionMatches, waitForInstalledVersion } from "./install-source";

const install = { sources: { ios: { dev: "testflight" as const } } };
assert.equal(installSourceOf(install, "ios", "dev"), "testflight");
assert.equal(installSourceOf(install, "ios", "prod"), "firebase");
assert.equal(installSourceOf(install, "android", "dev"), "firebase");
assert.equal(installSourceOf({}, "ios", "dev"), "firebase");

assert.equal(versionMatches("2.0.20", "2.0.20+419"), true);
assert.equal(versionMatches("2.0.20+419", "2.0.20+419"), true);
assert.equal(versionMatches("2.0.20+419", "2.0.20+418"), false);
assert.equal(versionMatches("2.0.20", "2.0.19+418"), false);
assert.equal(versionMatches("2.0.20", null), false);

// 두 번째 확인에서 자동 업데이트가 끝난다
{
  let clock = 0;
  const seen = ["2.0.19+418", "2.0.20+419"];
  const result = await waitForInstalledVersion({
    requested: "2.0.20+419",
    readInstalled: async () => seen.shift() ?? "2.0.20+419",
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
  });
  assert.deepEqual(result, { ok: true });
  assert.equal(clock, 15_000);
}

// 끝내 안 깔리면 이유와 지금 버전을 남긴다. 읽기 오류 회차는 건너뛴다
{
  let clock = 0;
  let calls = 0;
  const result = await waitForInstalledVersion({
    requested: "2.0.20",
    readInstalled: async () => {
      calls += 1;
      if (calls === 2) throw new Error("device not found");
      return "2.0.19+418";
    },
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
    waitMs: 60_000,
  });
  assert.deepEqual(result, { ok: false, message: testflightTimeoutMessage("2.0.20", "2.0.19+418", 60_000) });
}

console.log("install-source ok");

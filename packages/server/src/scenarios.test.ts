import assert from "node:assert/strict";

import { sampleApp } from "@device-farm/core/config/sample-app";

import { farmScenarios, isUncheckedPath } from "./scenarios";

// 설정 목록에 없는 경로를 빼려 하면 오타이거나 목록이 바뀐 것이다
const allPaths = new Set(sampleApp.scenarios.map((scenario) => scenario.path));
for (const path of sampleApp.excludedScenarioPaths) assert.ok(allPaths.has(path), `시나리오에 없는 경로: ${path}`);

const scenarios = farmScenarios(sampleApp);
assert.equal(scenarios.length, sampleApp.scenarios.length - sampleApp.excludedScenarioPaths.length);
assert.ok(!scenarios.some((scenario) => scenario.path === "/order/complete"));
assert.ok(scenarios.some((scenario) => scenario.path === "/home"));
assert.deepEqual(farmScenarios({ scenarios: [], excludedScenarioPaths: ["/x"], uncheckedPathPrefixes: [] }), []);
// 어떤 점검에도 넣지 않는 경로 앞머리. 이름만 비슷한 경로는 남긴다
const prefixes = ["/dev", "/legacy"];
for (const path of ["/dev", "/dev/sample", "/legacy", "/legacy/upload", "/legacy?x=1"]) assert.ok(isUncheckedPath(path, prefixes), path);
for (const path of ["/", "/developer", "/legacy-info", "/my"]) assert.ok(!isUncheckedPath(path, prefixes), path);
assert.equal(isUncheckedPath("/dev", []), false);
assert.deepEqual(farmScenarios({ scenarios: [{ path: "/dev/sample", name: "a", when: "b", then: "c" }], excludedScenarioPaths: [], uncheckedPathPrefixes: prefixes }), []);

console.log("farm-scenarios ok");

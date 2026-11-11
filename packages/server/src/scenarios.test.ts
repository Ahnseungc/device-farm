import assert from "node:assert/strict";

import { sampleApp } from "@device-farm/core/config/sample-app";

import { farmScenarios } from "./scenarios";

// 설정 목록에 없는 경로를 빼려 하면 오타이거나 목록이 바뀐 것이다
const allPaths = new Set(sampleApp.scenarios.map((scenario) => scenario.path));
for (const path of sampleApp.excludedScenarioPaths) assert.ok(allPaths.has(path), `시나리오에 없는 경로: ${path}`);

const scenarios = farmScenarios(sampleApp);
assert.equal(scenarios.length, sampleApp.scenarios.length - sampleApp.excludedScenarioPaths.length);
assert.ok(!scenarios.some((scenario) => scenario.path === "/order/complete"));
assert.ok(scenarios.some((scenario) => scenario.path === "/home"));
assert.deepEqual(farmScenarios({ scenarios: [], excludedScenarioPaths: ["/x"] }), []);

console.log("farm-scenarios ok");

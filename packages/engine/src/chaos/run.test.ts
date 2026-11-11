import assert from "node:assert/strict";

import { parseForegroundPackage } from "./run";

// 광고가 다른 앱을 연 뒤의 dumpsys
assert.equal(
  parseForegroundPackage("    topResumedActivity=ActivityRecord{be62e0e u0 com.example.adapp/.MainActivity} t1317}"),
  "com.example.adapp",
);
assert.equal(parseForegroundPackage(""), null);

console.log("chaos run ok");

import assert from "node:assert/strict";

import { buildRowLabel, nearestByY, versionGroupPrefix } from "./testflight";

assert.equal(versionGroupPrefix("2.0.20+426"), "2.0.20,");
assert.equal(versionGroupPrefix("2.0.20"), "2.0.20,");
assert.equal(buildRowLabel("2.0.20+426"), "2.0.20(426)");
// 빌드 번호가 없으면 묶음 맨 위(최신) 줄
assert.equal(buildRowLabel("2.0.20"), null);
// 줄마다 「설치」 라벨이 같아 같은 높이의 버튼을 고른다
assert.deepEqual(nearestByY(420, [{ y: 150, id: "426" }, { y: 430, id: "420" }, { y: 700, id: "419" }]), { y: 430, id: "420" });
assert.equal(nearestByY(10, []), null);

console.log("testflight ok");

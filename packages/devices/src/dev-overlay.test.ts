import assert from "node:assert/strict";

import { devChipBoxes, devPreviewClosePoint, inBoxes } from "./dev-overlay";

const node = (label: string, bounds: string, clickable = true) => `<node text="" class="android.view.View" content-desc="${label}" clickable="${clickable}" bounds="${bounds}" />`;
const config = { chips: ["광고 테스트", "미리보기"], preview: { marker: "다시", close: "닫기" } };
const chips = node("광고 테스트", "[21,1888][196,1970]") + node("미리보기", "[21,1983][196,2064]");
const page = node("화면", "[0,0][1080,2400]", false);

assert.deepEqual(devChipBoxes(page + chips, config).map((box) => [box.left, box.top, box.right, box.bottom]), [[13, 1880, 204, 1978], [13, 1975, 204, 2072]]);
assert.deepEqual(devChipBoxes(page, config), []);
// 그려지지 않은 노드는 세지 않는다
assert.deepEqual(devChipBoxes(node("미리보기", "[0,0][0,0]"), config), []);

const boxes = devChipBoxes(chips, config);
assert.equal(inBoxes(boxes, 100, 2020), true);
assert.equal(inBoxes(boxes, 540, 2020), false);

const preview = node("다시", "[780,100][880,190]") + node("닫기", "[940,100][1060,190]");
assert.deepEqual(devPreviewClosePoint(page + chips + preview, config), { x: 1000, y: 145 });
// 칩이 없는 빌드, 「다시」가 없는 화면, 화면 아래쪽 「닫기」는 미리보기가 아니다
assert.equal(devPreviewClosePoint(page + preview, config), null);
assert.equal(devPreviewClosePoint(page + chips + node("닫기", "[940,100][1060,190]"), config), null);
assert.equal(devPreviewClosePoint(page + chips + node("다시", "[780,2000][880,2090]") + node("닫기", "[940,2000][1060,2090]"), config), null);

// 미리보기 설정이 없으면 아무것도 닫지 않는다
assert.equal(devPreviewClosePoint(page + chips + preview, { chips: config.chips }), null);

console.log("dev-overlay ok");

import assert from "node:assert/strict";

import { clickLabels } from "./driver";

// 홈 탭은 어느 이름으로 불러도 웹에 적힌 글자 전부를 찾아본다(적힌 순서대로)
const nav = { homeTabName: "마이 페이지", homeTabLabels: ["마이", "마이 페이지"] };
assert.deepEqual(clickLabels(nav, nav.homeTabName, "link"), nav.homeTabLabels);
assert.deepEqual(clickLabels(nav, "마이", "link"), nav.homeTabLabels);
// 다른 탭·버튼은 그 이름 그대로
assert.deepEqual(clickLabels(nav, "카테고리", "link"), ["카테고리"]);
assert.deepEqual(clickLabels(nav, "마이 페이지", "button"), ["마이 페이지"]);
// 적힌 글자가 따로 없으면 홈 탭 이름 하나
assert.deepEqual(clickLabels({ homeTabName: "홈" }, "홈", "link"), ["홈"]);

console.log("home tab ok");

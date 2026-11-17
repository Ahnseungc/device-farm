import assert from "node:assert/strict";

import { layoutChecks, layoutMessage, layoutScript, visibleRectSource, type LayoutFacts } from "./layout";

const box = { x: 0, y: 0, width: 10, height: 10 };
const clean: LayoutFacts = { viewport: { width: 360, height: 800 }, pageOverflow: false, outside: [], clipped: [], overlaps: [], cutBottom: [], blank: false };

// 깨끗한 화면은 다섯 항목 모두 통과
assert.deepEqual(layoutChecks(clean).map((item) => item.ok), [true, true, true, true, true]);
assert.equal(layoutMessage(layoutChecks(clean)), null);

// 겹침·잘림은 글자를 인용하고, 같은 글자는 한 번만, 넷째부터는 「외 n개」
const broken = layoutChecks({
  ...clean,
  clipped: ["가", "가", "나", "다", "라"].map((label) => ({ label, box })),
  overlaps: [[{ label: "보유 26.35g", box }, { label: "4,809,534원", box }]],
});
assert.equal(broken.find((item) => item.id === "layout-clipped")?.message, "말줄임 없이 잘렸습니다: 「가」 · 「나」 · 「다」 외 1개");
assert.equal(broken.find((item) => item.id === "layout-overlap")?.message, "글자끼리 겹칩니다: 「보유 26.35g」↔「4,809,534원」");
assert.ok(layoutMessage(broken)?.startsWith("[화면 깨짐] 글자 잘림 — "));

// 문서가 좌우로 밀리는데 넘친 요소를 못 찾아도 실패
assert.equal(layoutChecks({ ...clean, pageOverflow: true }).find((item) => item.id === "layout-outside")?.ok, false);
assert.equal(layoutChecks({ ...clean, blank: true })[0].ok, false);

// 스크립트는 문자열 그대로 페이지에서 돈다 — 문법만 확인
assert.doesNotThrow(() => new Function(`return ${layoutScript}`));

// 겹침은 잘라 주는 영역 안에 보이는 글자 폭으로 잰다
type Rect = { left: number; top: number; right: number; bottom: number; width: number; height: number };
const visibleRect = new Function(`return ${visibleRectSource}`)() as (r: Rect, clips: object[]) => Rect;
const rect = (left: number, top: number, width: number, height: number): Rect => ({ left, top, right: left + width, bottom: top + height, width, height });
const overlapRatio = (a: Rect, b: Rect) => {
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return w <= 0 || h <= 0 ? 0 : (w * h) / Math.min(a.width * a.height, b.width * b.height);
};
const joinButton = rect(270, 100, 70, 20); // 「참여하기」
// 오탐(2026-11-17): 말줄임된 배너 제목 — Range는 글자 전체 폭(400px)이지만 truncate 영역(250px) 밖은 안 보인다
const fullTitle = rect(10, 100, 400, 20);
const truncateBox = { left: 10, top: 98, right: 260, bottom: 124, x: true, y: true };
assert.ok(overlapRatio(fullTitle, joinButton) > 0.3);
assert.equal(visibleRect(fullTitle, [truncateBox]).right, 260);
assert.equal(overlapRatio(visibleRect(fullTitle, [truncateBox]), joinButton), 0);
// 진짜 겹침: 잘라 주는 영역이 없으면(overflow: visible) 글자 폭 그대로라 계속 겹침으로 잡힌다
assert.equal(visibleRect(fullTitle, []).width, 400);
assert.ok(overlapRatio(visibleRect(fullTitle, []), joinButton) > 0.3);
// 잘라 주는 영역 안에서 겹친 글자도 계속 잡힌다
assert.ok(overlapRatio(visibleRect(fullTitle, [{ left: 0, top: 0, right: 360, bottom: 800, x: true, y: true }]), joinButton) > 0.3);

console.log("layout ok");

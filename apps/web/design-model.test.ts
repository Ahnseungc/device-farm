import assert from "node:assert/strict";

import type { DesignPage } from "@device-farm/core/policy/design-page";

import { matchTone, percent, summarize, visiblePages } from "./design-model";

const last = (figmaCoverage: number | undefined, mismatches: number) => ({ runId: "r", at: "2026-11-17T05:00:00.000Z", deviceId: "A", status: "passed", mismatches, ...(figmaCoverage === undefined ? {} : { figmaCoverage }) });
const pages: DesignPage[] = [
  { path: "/home", hasFigma: true, rules: 2, last: last(0.82, 1) },
  { path: "/cart", hasFigma: true, rules: 0, last: last(0.4, 0) },
  { path: "/notice", hasFigma: false, rules: 1, last: last(undefined, 3) },
  { path: "/settings", hasFigma: true, rules: 0, last: null },
  { path: "/checkout", hasFigma: true, rules: 0, last: last(0, 0) },
];

assert.equal(percent(0.824), "82%");
assert.equal(percent(undefined), "—");
assert.deepEqual([0.9, 0.5, 0.3, 0.1, 0, undefined].map(matchTone), ["good", "fair", "fair", "suspect", "suspect", "none"]);

// 요약: 잰 화면만 평균(30% 미만 「피그마 확인 필요」는 빼고 따로 센다), 어긋남 있는 화면 수
const summary = summarize(pages);
assert.equal(summary.total, 5);
assert.equal(summary.checked, 4);
assert.equal(Math.round((summary.averageMatch ?? 0) * 100), 61);
assert.equal(summary.withMismatch, 2);
assert.equal(summary.figmaSuspect, 1);
assert.equal(summarize([]).averageMatch, undefined);

// 정렬·찾기: 일치율 정렬은 잰 화면 → 피그마 확인 필요 → 안 잰 화면
assert.deepEqual(visiblePages(pages, "", "path").map((page) => page.path), ["/cart", "/checkout", "/home", "/notice", "/settings"]);
assert.deepEqual(visiblePages(pages, "", "match").map((page) => page.path), ["/cart", "/home", "/checkout", "/notice", "/settings"]);
assert.deepEqual(visiblePages(pages, "", "mismatch").map((page) => page.path), ["/notice", "/home", "/cart", "/checkout", "/settings"]);
assert.deepEqual(visiblePages(pages, " HOME ", "path").map((page) => page.path), ["/home"]);

console.log("design model ok");

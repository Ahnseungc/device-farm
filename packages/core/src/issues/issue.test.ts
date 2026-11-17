import assert from "node:assert/strict";

import type { PolicyAlert } from "../slack/policy-alert";

import { issueOf, openCounts, sortIssues, type StoredAlert } from "./issue";

const policy: PolicyAlert = {
  key: "p",
  ignoreKey: "r1",
  ignoreHash: "h",
  finding: "bug-candidate",
  path: "/dev/farm-sample",
  title: "Lv5 혜택에 0.1g 골드바 선물이 보인다",
  message: "화면에 「0.1g 골드바 1개 선물」가 없습니다.",
  policy: { title: "레벨 통합 정책", url: "https://wiki/x" },
  figmaUrls: ["https://figma/1"],
  device: "SM-A325N",
  build: "dev 2.0.28",
  runId: "r1",
};
const stored = (alert: StoredAlert["alert"], status: StoredAlert["status"], sentAt: string, ts = "1.1"): StoredAlert => ({ alert, status, sentAt, ts });

// 정책 버그 후보는 정책 위반, 정책서·피그마 링크
const issue = issueOf("p", stored(policy, "open", "2026-11-12T03:00:00Z"));
assert.equal(issue.kind, "policy");
assert.equal(issue.label, "버그 후보");
assert.deepEqual(issue.links.map((link) => link.label), ["정책서 · 레벨 통합 정책", "피그마 1"]);
// 정책 문서가 뒤처진 것은 문서 갱신, 피그마 없이 판단 못 한 것은 확인 필요
assert.equal(issueOf("d", stored({ ...policy, finding: "policy-outdated" }, "open", "")).kind, "docs");
assert.equal(issueOf("u", stored({ ...policy, finding: "unverified" }, "open", "")).kind, "unverified");
// 점검 실패·피그마 차이 묶음
const failure = issueOf("f", stored({ type: "failure", key: "f", path: "플로우 점검 · 알림", finding: "behavior", message: "1단계 실패", device: "A", build: "dev", runId: "r2" }, "checking", "2026-11-12T04:00:00Z", ""));
assert.equal(failure.kind, "behavior");
assert.equal(failure.onSlack, false);
const design = issueOf(
  "g",
  stored(
    { type: "design", key: "g", path: "/dev/farm-sample", finding: "design-diff", diffs: [], screens: [{ path: "/dev/farm-sample", texts: ["레벨별 보상"], figmaUrls: ["https://figma/2"] }], device: "A", build: "dev", runId: "r3" },
    "done",
    "2026-11-12T05:00:00Z",
  ),
);
assert.equal(design.kind, "design");
assert.deepEqual(design.items, [{ path: "/dev/farm-sample", texts: ["레벨별 보상"] }]);

// 열린 것(확인 중 포함) 먼저, 그 안에서 최근 것 먼저. 수는 열린 것만
assert.deepEqual(sortIssues([design, issue, failure]).map((item) => item.key), ["p", "f", "g"]);
assert.equal(openCounts([design, issue, failure]).policy, 1);
assert.equal(openCounts([design, issue, failure]).design, 0);

console.log("issues ok");

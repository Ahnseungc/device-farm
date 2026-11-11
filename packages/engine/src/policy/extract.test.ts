import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { ScreenDriver } from "@device-farm/core/device/driver";
import type { PolicySnapshot } from "@device-farm/core/policy/snapshot";

import type { AskClaude } from "./claude";
import { hashBody, type ConfluenceConfig, type FetchLike } from "./confluence";
import { refreshRules } from "./extract";
import { figmaRefs, fetchFigmaTexts } from "./figma";
import { readAllPageRules, readJudgeCache } from "./rules-store";
import { checkPolicyScreen, policyScreens } from "./screen-check";
import { sampleApp } from "@device-farm/core/config/sample-app";

const config: ConfluenceConfig = { email: "a@b", token: "t", cloudId: "cloud", spaceKey: "SHOP", titleQuery: "통합 정책", siteUrl: "https://example.atlassian.net/wiki" };
const storage =
  '<p>포인트는 10,000원 이상부터 출금할 수 있어요.</p><p>PROCESSING이면 출금 취소 버튼 미노출</p><a href="https://www.figma.com/design/AbC123/shop?node-id=12-34&amp;t=x">피그마</a>';
const page = { id: "1", title: "포인트 출금 통합 정책", version: { number: 7, createdAt: "2026-09-01T00:00:00.000Z" }, body: { storage: { value: storage } } };
const fetchImpl: FetchLike = async () => ({ ok: true, status: 200, json: async () => page });
const snapshot: PolicySnapshot = {
  checkedAt: "2026-11-11T00:00:00.000Z",
  pages: { "1": { id: "1", title: page.title, version: 7, modifiedAt: page.version.createdAt, hash: hashBody(storage), webUrl: "" } },
};

const extraction = JSON.stringify({
  screens: ["/my/withdraw"],
  rules: [
    { kind: "copy", section: "안내", statement: "최소 출금 안내", expected: "포인트는 10,000원 이상부터 출금할 수 있어요.", evidence: "포인트는 10,000원 이상부터 출금할 수 있어요.", screens: ["/my/withdraw"], visibleOnOpen: true },
    { kind: "behavior", section: "상태", statement: "처리 중이면 취소 버튼 숨김", evidence: "PROCESSING이면 출금 취소 버튼 미노출", screens: ["/my/withdraw"], visibleOnOpen: false },
    { kind: "copy", section: "안내", statement: "지어낸 문구", expected: "5,000원부터", evidence: "5,000원부터 출금", screens: ["/my/withdraw"], visibleOnOpen: true },
  ],
});

const root = mkdtempSync(path.join(tmpdir(), "policy-rules-"));
try {
  let asked = 0;
  const ask: AskClaude = async (prompt) => {
    asked += 1;
    if (prompt.includes("판정")) return '{"verdicts":[{"ruleId":"__ID__","result":"match","reason":""}]}'.replace("__ID__", behaviorId());
    assert.ok(prompt.includes("/my/withdraw"));
    return extraction;
  };
  const deps = { config, ask, fetchImpl, knownScreens: ["/my/withdraw"], log: () => {}, root };

  // 처음엔 뽑고, 지어낸 규칙은 버린다. 피그마 링크도 남긴다
  const first = await refreshRules(snapshot, deps);
  assert.equal(first.extracted, 1);
  const [rules] = readAllPageRules(root);
  assert.equal(rules.rules.length, 2);
  assert.equal(rules.dropped.length, 1);
  assert.deepEqual(rules.figma, ["AbC123:12:34"]);
  const behaviorId = () => rules.rules.find((rule) => rule.kind === "behavior")!.id;

  // 본문 해시가 같으면 다시 묻지 않는다
  assert.equal((await refreshRules(snapshot, deps)).extracted, 0);
  assert.equal(asked, 1);

  // 스냅샷에서 사라진 페이지는 규칙도 지운다
  // (아래 화면 점검 뒤에 확인)

  // 화면 점검: 문구 통과 + 피그마 차이 + 판정은 한 번만 묻고 캐시
  const [screen] = policyScreens(readAllPageRules(root), ["/my/withdraw"], { "AbC123:12:34": { hash: "f1", texts: ["출금하기", "출금 가능 금액"] } });
  assert.equal(screen.path, "/my/withdraw");
  const driver = {
    app: sampleApp,
    navigate: async () => {},
    currentPath: async () => "/my/withdraw",
    evaluate: async () => "포인트는 10,000원 이상부터\n출금할 수 있어요.\n출금하기",
    screenshot: async () => Buffer.from("png"),
  } as unknown as ScreenDriver;
  const report = await checkPolicyScreen(driver, screen, { ask, ignores: [], root, settleMs: 0, now: () => Date.parse("2026-11-11T00:00:00.000Z") });
  assert.equal(report.judgeError, undefined);
  assert.equal(report.checks.find((check) => check.id === behaviorId())?.ok, true);
  assert.ok(report.checks.some((check) => check.title === "피그마 문구 「출금할 수 있어요.」"));
  assert.equal(Object.keys(readJudgeCache(root)).length, 1);
  const again = await checkPolicyScreen(driver, screen, { ask, ignores: [], root, settleMs: 0 });
  assert.equal(again.cached, true);
  assert.equal(asked, 2);

  // 다른 화면이 열려 있으면 비교하지 않는다
  const wrong = await checkPolicyScreen({ ...driver, currentPath: async () => "/home" } as ScreenDriver, screen, { ask, ignores: [], root, settleMs: 0 });
  assert.equal(wrong.checks[0].id, "open");

  await refreshRules({ ...snapshot, pages: {} }, deps);
  assert.equal(readAllPageRules(root).length, 0);
} finally {
  rmSync(root, { recursive: true, force: true });
}

// 피그마 링크 형태 셋 다 `파일:노드`
assert.deepEqual(figmaRefs('figma.com/file/K1/x?node-id=1%3A2 figma.com/proto/K2/y?type=design&node-id=3-4'), ["K1:1:2", "K2:3:4"]);
// 노드의 TEXT 글자를 모은다
const figmaFetch: FetchLike = async (url, init) => {
  assert.equal(init.headers["X-Figma-Token"], "ft");
  assert.ok(url.startsWith("https://api.figma.com/v1/files/K1/nodes?ids="));
  return { ok: true, status: 200, json: async () => ({ nodes: { "1:2": { document: { type: "FRAME", children: [{ type: "TEXT", characters: " 출금하기 " }, { type: "TEXT", characters: "" }] } } } }) };
};
assert.deepEqual((await fetchFigmaTexts("ft", ["K1:1:2"], figmaFetch))["K1:1:2"].texts, ["출금하기"]);

console.log("policy extract ok");

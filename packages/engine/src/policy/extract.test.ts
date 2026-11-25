import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { ScreenDriver } from "@device-farm/core/device/driver";
import { compareCopyRules } from "@device-farm/core/policy/compare";
import type { PolicySnapshot } from "@device-farm/core/policy/snapshot";

import { openFarmDb } from "../db/farm-db";

import type { AskClaude } from "./claude";
import { hashBody, type ConfluenceConfig, type FetchLike } from "./confluence";
import { refreshRules } from "./extract";
import { figmaRefs, fetchFigmaTexts } from "./figma";
import { readAllPageRules, readJudgeCache } from "./rules-store";
import { checkPolicyScreen, policyScreens, withScreenAliases } from "./screen-check";
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
const db = openFarmDb(":memory:");
try {
  let asked = 0;
  const ask: AskClaude = async (prompt) => {
    asked += 1;
    if (prompt.includes("판정")) return '{"verdicts":[{"ruleId":"__ID__","result":"match","reason":""}]}'.replace("__ID__", behaviorId());
    assert.ok(prompt.includes("/my/withdraw"));
    return extraction;
  };
  const deps = { config, ask, fetchImpl, knownScreens: ["/my/withdraw"], log: () => {}, db };

  // 처음엔 뽑고, 지어낸 규칙은 버린다. 피그마 링크도 남긴다
  const first = await refreshRules(snapshot, deps);
  assert.equal(first.extracted, 1);
  const [rules] = readAllPageRules(db);
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
  // 피그마 차이는 프론트 코드가 단 노드의 피그마 페이지 전체와 본다
  const figmaCache = { "AbC123:12:34": { hash: "f1", texts: ["출금하기", "출금 가능 금액"] }, "page:AbC123:1:1": { hash: "p1", texts: ["출금하기", "출금 가능 금액", "포인트는 10,000원 이상부터"] } };
  const front = { "/my/withdraw": ["AbC123:12:34"] };
  const pageOf = { "AbC123:12:34": "AbC123:1:1" };
  const [screen] = policyScreens(readAllPageRules(db), ["/my/withdraw"], figmaCache, front, pageOf);
  assert.equal(screen.path, "/my/withdraw");
  const driver = {
    app: sampleApp,
    navigate: async () => {},
    currentPath: async () => "/my/withdraw",
    evaluate: async () => "포인트는 10,000원 이상부터\n출금할 수 있어요.\n출금하기",
    screenshot: async () => Buffer.from("png"),
  } as unknown as ScreenDriver;
  const report = await checkPolicyScreen(driver, screen, { ask, ignores: [], root, db, settleMs: 0, now: () => Date.parse("2026-11-11T00:00:00.000Z") });
  assert.equal(report.judgeError, undefined);
  assert.equal(report.checks.find((check) => check.id === behaviorId())?.ok, true);
  assert.ok(report.checks.some((check) => check.title === "피그마 문구 「출금할 수 있어요.」"));
  assert.equal(Object.keys(readJudgeCache(db)).length, 1);
  const again = await checkPolicyScreen(driver, screen, { ask, ignores: [], root, db, settleMs: 0 });
  assert.equal(again.cached, true);
  assert.equal(asked, 2);
  // 같은 페이지의 다른 프레임(시트·팝업)에 있는 문구는 차이가 아니다
  const [withSheet] = policyScreens(readAllPageRules(db), ["/my/withdraw"], { ...figmaCache, "page:AbC123:1:1": { hash: "p2", texts: ["출금하기", "출금할 수 있어요."] } }, front, pageOf);
  const sheetReport = await checkPolicyScreen(driver, withSheet, { ask, ignores: [], root, db, settleMs: 0 });
  assert.ok(!sheetReport.checks.some((check) => check.id.startsWith("figma:")));
  // 프론트 코드가 단 노드가 없으면(정책서 링크만) 피그마 차이는 보지 않는다
  const [policyOnly] = policyScreens(readAllPageRules(db), ["/my/withdraw"], figmaCache);
  assert.equal(policyOnly.figmaPage, null);

  // 규칙 없이 프론트 코드만 피그마를 단 화면도 대조한다. 점검·지도에서 본 경로(knownPaths)만
  {
    const frontOnly = { ...front, "/price": ["AbC123:12:34"], "/shop/buy/success": ["AbC123:12:34"] };
    const paths = policyScreens(readAllPageRules(db), ["/my/withdraw", "/price"], figmaCache, frontOnly, pageOf).map((item) => item.path);
    assert.deepEqual(paths, ["/my/withdraw", "/price"]);
  }

  // 「디자인 확인」(stay): 다시 열지 않고 지금 화면을 본다
  {
    let navigated = 0;
    const stayed = await checkPolicyScreen({ ...driver, navigate: async () => void (navigated += 1) } as ScreenDriver, screen, { ask, ignores: [], root, db, settleMs: 0, stay: true });
    assert.equal(navigated, 0);
    assert.ok(!stayed.checks.some((check) => check.id === "open"));
  }

  // 정책 글자가 화면에 그대로 없으면 판정에 같이 묻고, 같은 뜻이면 「같은 뜻, 다른 문구」로 통과
  {
    const copyId = rules.rules.find((rule) => rule.kind === "copy")!.id;
    let prompt = "";
    const meaningAsk: AskClaude = async (text) => {
      prompt = text;
      return JSON.stringify({ verdicts: [{ ruleId: behaviorId(), result: "match", reason: "" }, { ruleId: copyId, result: "match", reason: "「1만원부터 출금할 수 있어요」" }] });
    };
    const reworded = { ...driver, evaluate: async () => "1만원부터 출금할 수 있어요\n출금하기" } as ScreenDriver;
    const meaning = await checkPolicyScreen(reworded, screen, { ask: meaningAsk, ignores: [], root, db, settleMs: 0 });
    assert.match(prompt, /\[문구\]/);
    const copyCheck = meaning.checks.find((check) => check.id === copyId);
    assert.equal(copyCheck?.ok, true);
    assert.equal(copyCheck?.message, "같은 뜻, 다른 문구: 「1만원부터 출금할 수 있어요」");
    // Claude를 못 쓰면(캐시도 없으면) 글자 비교 결과 그대로
    const unseen = { ...driver, evaluate: async () => "처음 보는 화면\n출금하기" } as ScreenDriver;
    const literalOnly = await checkPolicyScreen(unseen, screen, { ask: null, ignores: [], root, db, settleMs: 0 });
    assert.match(literalOnly.judgeError ?? "", /문구 뜻/);
    assert.equal(literalOnly.checks.find((check) => check.id === copyId)?.ok, false);
  }

  // 다른 화면이 열려 있으면 비교하지 않는다
  const wrong = await checkPolicyScreen({ ...driver, currentPath: async () => "/home" } as ScreenDriver, screen, { ask, ignores: [], root, db, settleMs: 0 });
  assert.equal(wrong.checks[0].id, "open");

  await refreshRules({ ...snapshot, pages: {} }, deps);
  assert.equal(readAllPageRules(db).length, 0);
} finally {
  db.close();
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

// 테스트 경로는 실제 화면의 규칙·피그마로 대조한다. 실제 화면에 규칙이 없거나 이미 있는 경로면 더하지 않는다
{
  const rule = { id: "r1", pageId: "p", pageTitle: "레벨 통합 정책", pageHash: "h", since: "2026-01-01T00:00:00.000Z", kind: "copy" as const, section: "", statement: "Lv5 골드바", expected: "0.1g 골드바 1개 선물", evidence: "0.1g 골드바 1개 선물", screens: ["/benefit/level-guide"], visibleOnOpen: true };
  const real = { path: "/benefit/level-guide", rules: [rule], figma: { hash: "f", texts: ["0.1g 골드바 1개 선물"] } };
  const aliased = withScreenAliases([real], { "/dev/farm-sample": "/benefit/level-guide", "/dev/none": "/nowhere" });
  assert.deepEqual(aliased.map((screen) => screen.path), ["/benefit/level-guide", "/dev/farm-sample"]);
  assert.equal(aliased[1].figma, real.figma);
  // 테스트 경로에서도 문구 비교가 돈다: 정책·피그마에 있는 문구가 화면에 없으면 버그 후보
  const checks = compareCopyRules(aliased[1].rules, { path: "/dev/farm-sample", text: "0.05g 골드바 1개 선물 지급", ignores: [], screenChanged: false, now: Date.parse("2026-11-12T00:00:00.000Z"), figmaTexts: aliased[1].figma?.texts });
  assert.equal(checks[0]?.finding, "bug-candidate");
  console.log("screen alias ok");
}


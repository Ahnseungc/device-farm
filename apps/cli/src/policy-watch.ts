// 정책 바뀜 감지: npm run policy-watch
// Confluence 정책 스페이스에서 제목 규칙(policy.confluence.titleQuery)에 맞는 페이지 + policy/sources.json 등록 페이지의 본문 해시를 지난 스냅샷과 비교한다(LLM 없음).
// 결과: test-results/policy/snapshot.json(최신), changes.jsonl(바뀜 기록)
// 규칙 하나만 뽑기(Claude): npm run policy-watch -- --extract <pageId> → test-results/policy/rules/<pageId>.json
// 피그마만 새로(프론트 코드 → 화면별 노드, 노드 문구): npm run policy-watch -- --figma
import { isRecentlyChanged } from "@device-farm/core/policy/snapshot";
import { confluenceConfigFromEnv, fetchPolicySnapshot } from "@device-farm/engine/policy/confluence";
import { askClaude } from "@device-farm/engine/policy/claude";
import { extractPage } from "@device-farm/engine/policy/extract";
import { readPageRules } from "@device-farm/engine/policy/rules-store";
import { readSources, recordSnapshot } from "@device-farm/engine/policy/store";
import { readScreenMap } from "@device-farm/engine/screen-map-store";
import { refreshFigma, refreshFrontFigma } from "@device-farm/server/policy-watch";
import { farmScenarios } from "@device-farm/server/scenarios";
import type { AppConfig } from "@device-farm/core/config/app-config";

import { cliApp } from "./app";

const kindLabels = { added: "추가", changed: "변경", removed: "삭제" } as const;

/** 시나리오 + 화면 지도 경로(디바이스팜 서버 `knownScreens`와 같다) */
function knownScreens(app: AppConfig): string[] {
  const edges = readScreenMap().edges;
  return [...new Set([...farmScenarios(app).map((scenario) => scenario.path), ...edges.map((edge) => edge.from), ...edges.flatMap((edge) => (edge.to ? [edge.to] : []))])].sort();
}

async function extractOne(app: AppConfig, config: NonNullable<ReturnType<typeof confluenceConfigFromEnv>>, pageId: string): Promise<void> {
  await extractPage(pageId, { config, ask: askClaude, fetchImpl: (url, init) => fetch(url, init), knownScreens: knownScreens(app), appName: app.name, log: console.log });
  const rules = readPageRules(pageId);
  for (const rule of rules?.rules ?? []) console.log(`  ${rule.kind} ${rule.visibleOnOpen ? "열면 보임" : "상황 필요"} ${rule.statement}${rule.expected ? ` 「${rule.expected}」` : ""} → ${rule.screens.join(", ") || "화면 없음"}`);
  for (const item of rules?.dropped ?? []) console.log(`  버림 ${item.statement} — ${item.reason}`);
  console.log(`  화면 ${rules?.screens.join(", ") || "없음"} · 피그마 ${rules?.figma.join(", ") || "없음"}`);
}

async function main(): Promise<void> {
  const app = await cliApp();
  if (process.argv.includes("--figma")) {
    refreshFrontFigma(app.figma, console.log);
    return refreshFigma((url, init) => fetch(url, init), console.log);
  }
  const config = confluenceConfigFromEnv(app.policy.confluence);
  if (!config) throw new Error("CONFLUENCE_EMAIL·CONFLUENCE_API_TOKEN(.env)과 policy.confluence(farm.config.ts)의 cloudId·spaceKey가 필요합니다.");
  const extractIndex = process.argv.indexOf("--extract");
  if (extractIndex >= 0) return extractOne(app, config, process.argv[extractIndex + 1] ?? "");
  const registered = readSources().pages.map((page) => page.pageId);
  const { snapshot, failed } = await fetchPolicySnapshot(config, registered, (url, init) => fetch(url, init));
  const changes = recordSnapshot(snapshot);
  const pages = Object.values(snapshot.pages);
  console.log(`정책 ${pages.length}개 확인 (${snapshot.checkedAt}) · 최근 14일 안 수정 ${pages.filter((page) => isRecentlyChanged(page)).length}개`);
  if (changes.length === 0) console.log("바뀐 정책 없음");
  for (const change of changes) {
    const version = change.before ? `v${change.before.version} → v${change.page.version}` : `v${change.page.version}`;
    console.log(`  ${kindLabels[change.kind]} ${change.page.title} (${version}, ${change.page.modifiedAt.slice(0, 10)}) ${change.page.webUrl}`);
  }
  for (const item of failed) console.log(`  읽기 실패 ${item.id}: ${item.message}`);
  process.exitCode = failed.length > 0 ? 1 : 0;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

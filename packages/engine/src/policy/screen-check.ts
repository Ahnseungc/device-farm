import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { ScreenDriver } from "@device-farm/core/device/driver";
import { samePath } from "@device-farm/core/device/screen-ready";
import {
  compareCopyRules,
  diffFigmaCopy,
  docsMismatchChecks,
  figmaChecks,
  figmaCoverage,
  minFigmaCoverage,
  rulesForScreen,
  screenTextHash,
  situationalRules,
  type PolicyCheck,
  type PolicyIgnore,
} from "@device-farm/core/policy/compare";
import { isSensitivePath, judgeKey, judgePrompt, parseVerdicts, verdictChecks } from "@device-farm/core/policy/judge";
import { screenMatches, shortHash, type PageRules, type PolicyRule } from "@device-farm/core/policy/rules";
import { sleep } from "@device-farm/core/sleep";

import type { FarmDb } from "../db/farm-db";

import type { AskClaude } from "./claude";
import type { FigmaTexts } from "./figma";
import { figmaPageKey, readJudgeCache, readScreenHashes, writeJudgeCache, writeScreenHashes } from "./rules-store";
import { policyRoot } from "./store";

/** 화면이 다 그려질 때까지 기다리는 시간 (데이터 QA `qaSettleMs`와 같은 판단) */
export const policySettleMs = 4_000;
/** 다른 화면이 열렸을 때 다시 여는 횟수(처음 포함) (작성자 판단) */
export const policyOpenAttempts = 2;
/** 점검할 정책 화면 하나: 경로와 그 화면에 걸린 규칙·피그마 문구 */
export interface PolicyScreen {
  path: string;
  rules: PolicyRule[];
  figma: FigmaTexts | null;
  /**
   * 프론트 코드가 이 화면에 단 노드가 있는 피그마 페이지 전체 문구. 「화면에 있는데 피그마에 없음」은 이것과만 본다.
   * 노드 하나는 기본 상태만 담아 시트·팝업 문구가 다 「없음」으로 나왔다(2026-11-12 74건 중 진짜 차이 10% 안팎). 없으면 그 검사를 하지 않는다.
   */
  figmaPage?: FigmaTexts | null;
}

export interface PolicyScreenReport {
  path: string;
  checks: PolicyCheck[];
  /** 상황을 만들어야 보여 이번에 확인하지 않은 규칙 수 */
  situational: number;
  /** 판정을 캐시에서 가져왔는가 */
  cached: boolean;
  /** 판정 실패 사유(Claude 로그인 풀림 등). 글자 비교는 그대로 남는다 */
  judgeError?: string;
  /** 화면 문구 중 피그마에 있는 비율. 낮아서 피그마를 안 쓴 화면 표시용 */
  figmaCoverage?: number;
}

/** 캐시에 있는 것만 합친다. 하나도 없으면 null */
function mergeTexts(keys: string[], cache: Record<string, FigmaTexts>): FigmaTexts | null {
  const found = keys.sort().flatMap((key) => (cache[key] ? [cache[key]] : []));
  const texts = found.flatMap((item) => item.texts);
  return texts.length > 0 ? { hash: shortHash(found.map((item) => item.hash).join(",")), texts } : null;
}

/**
 * 규칙·피그마가 걸린 화면 목록. `*`가 든 경로는 열 수 없으니 그 패턴에 맞는 구체 경로(화면 지도·시나리오)로 펼친다.
 * 피그마 문구는 그 화면을 다루는 정책들의 노드를 합친다. 페이지 문구는 프론트 코드가 단 노드의 페이지만(`pageOf`).
 */
export function policyScreens(
  pages: readonly PageRules[],
  knownPaths: readonly string[],
  figmaCache: Record<string, FigmaTexts>,
  frontRoutes: Record<string, string[]> = {},
  pageOf: Record<string, string> = {},
): PolicyScreen[] {
  const concrete = (pattern: string) => (pattern.includes("*") ? knownPaths.filter((known) => screenMatches(pattern, known)) : [pattern]);
  // 정책 규칙이 걸린 화면 + 프론트 코드가 피그마를 단 화면(규칙 없이 피그마 문구만 본다, 2026-11-17).
  // 피그마 화면은 점검·지도에서 이미 연 경로만 — 결제 완료·보상 받기처럼 열기만 해도 요청이 나갈 화면을 딥링크로 새로 열지 않는다
  const designPaths = Object.keys(frontRoutes).flatMap((route) => knownPaths.filter((known) => screenMatches(route, known)));
  const paths = new Set([...pages.flatMap((page) => [...page.screens, ...page.rules.flatMap((rule) => rule.screens)].flatMap(concrete)), ...designPaths]);
  const allRules = pages.flatMap((page) => page.rules);
  return [...paths].sort().map((screen) => {
    // 정책 본문에 적힌 노드 + 프론트 코드(스토리북·주석)가 이 화면에 단 노드
    const frontRefs = Object.entries(frontRoutes).flatMap(([route, routeRefs]) => (screenMatches(route, screen) ? routeRefs : []));
    const refs = new Set([...pages.filter((page) => page.screens.some((pattern) => screenMatches(pattern, screen))).flatMap((page) => page.figma), ...frontRefs]);
    return { path: screen, rules: rulesForScreen(allRules, screen), figma: mergeTexts([...refs], figmaCache), figmaPage: mergeTexts([...new Set(frontRefs.flatMap((ref) => (pageOf[ref] ? [figmaPageKey(pageOf[ref])] : [])))], figmaCache) };
  });
}

/** 테스트 경로를 실제 화면의 규칙·피그마로 대조하게 더한다(`policy/sources.json` `screenAliases`). 실제 화면에 규칙이 없으면 건너뛴다 */
export function withScreenAliases(screens: PolicyScreen[], aliases: Record<string, string> = {}): PolicyScreen[] {
  const byPath = new Map(screens.map((screen) => [screen.path, screen]));
  const extra = Object.entries(aliases).flatMap(([alias, target]) => {
    const source = byPath.get(target);
    // 규칙의 화면 목록에도 테스트 경로를 넣는다 — 문구 비교·상황 규칙 세기가 화면 경로로 규칙을 다시 거른다
    return source && !byPath.has(alias) ? [{ ...source, path: alias, rules: source.rules.map((rule) => ({ ...rule, screens: [...rule.screens, alias] })) }] : [];
  });
  return [...screens, ...extra];
}

export interface PolicyCheckDeps {
  ask: AskClaude | null;
  ignores: readonly PolicyIgnore[];
  now?: () => number;
  /** 판정 스크린샷 폴더. 없으면 policyRoot */
  root?: string;
  /** 판정 캐시·화면 해시 DB. 없으면 farm.db */
  db?: FarmDb;
  settleMs?: number;
  /** 화면을 다시 열지 않고 지금 화면을 본다(플로우 「디자인 확인」: 딥링크로는 플로우 중간 상태가 안 나온다) */
  stay?: boolean;
}

async function judge(screen: PolicyScreen, text: string, screenHash: string, screenChanged: boolean, driver: ScreenDriver, deps: PolicyCheckDeps) {
  const root = deps.root ?? policyRoot;
  const behaviors = screen.rules.filter((rule) => rule.kind === "behavior");
  const context = { ignores: deps.ignores, screenChanged, now: deps.now?.() ?? Date.now() };
  if (behaviors.length === 0) return { checks: [], cached: false };
  const key = judgeKey(screen.path, screenHash, behaviors, screen.figma?.hash ?? "");
  const cache = readJudgeCache(deps.db);
  if (cache[key]) return { checks: verdictChecks(behaviors, cache[key], context), cached: true };
  if (!deps.ask) return { checks: [], cached: false, judgeError: "Claude를 쓸 수 없어 화면 동작 규칙을 판정하지 않았습니다." };
  let screenshotFile: string | null = null;
  if (!isSensitivePath(screen.path)) {
    screenshotFile = path.join(root, "judge-shots", `${shortHash(key)}.png`);
    mkdirSync(path.dirname(screenshotFile), { recursive: true });
    writeFileSync(screenshotFile, await driver.screenshot());
  }
  const prompt = judgePrompt(screen.path, text, behaviors, screenshotFile, screen.figma?.texts ?? [], driver.app.name);
  const verdicts = parseVerdicts(await deps.ask(prompt, { allowRead: Boolean(screenshotFile) }), behaviors);
  writeJudgeCache({ ...readJudgeCache(deps.db), [key]: verdicts }, deps.db);
  return { checks: verdictChecks(behaviors, verdicts, context), cached: false };
}

/** 화면을 열고 문구 규칙·피그마 문구·화면 동작 판정을 돌린다. 판정이 실패해도 글자 비교 결과는 남긴다 */
export async function checkPolicyScreen(driver: ScreenDriver, policyScreen: PolicyScreen, deps: PolicyCheckDeps): Promise<PolicyScreenReport> {
  // 앱을 막 연 직후 딥링크가 홈으로 떨어진 적이 있어 한 번 더 연다
  let screen = policyScreen;
  let opened = "";
  if (deps.stay) opened = await driver.currentPath();
  for (let attempt = 0; attempt < policyOpenAttempts && !samePath(screen.path, opened); attempt += 1) {
    await driver.navigate(screen.path);
    await sleep(deps.settleMs ?? policySettleMs);
    opened = await driver.currentPath();
  }
  if (!samePath(screen.path, opened)) {
    return { path: screen.path, situational: 0, cached: false, checks: [{ id: "open", title: "화면 열기", ok: false, message: `${screen.path} 대신 ${opened} 화면이 열려 있습니다.`, ignoreKey: "open", ignoreHash: "" }] };
  }
  const text = await driver.evaluate<string>("document.body.innerText");
  // 다른 화면 디자인과 비교하면 오탐뿐이라 피그마 없이 본다(차이는 「확인 필요」로 내려간다)
  const coverage = screen.figma ? figmaCoverage(screen.figma.texts, text) : undefined;
  if (coverage !== undefined && coverage < minFigmaCoverage) screen = { ...screen, figma: null };
  const screenHash = screenTextHash(text);
  const hashes = readScreenHashes(deps.db);
  const screenChanged = hashes[screen.path] !== undefined && hashes[screen.path] !== screenHash;
  writeScreenHashes({ ...hashes, [screen.path]: screenHash }, deps.db);

  const now = deps.now?.() ?? Date.now();
  const checks: PolicyCheck[] = compareCopyRules(screen.rules, { path: screen.path, text, ignores: deps.ignores, screenChanged, now, figmaTexts: screen.figma?.texts ?? null });
  if (screen.figma) {
    if (screen.figmaPage) checks.push(...figmaChecks(diffFigmaCopy(screen.figmaPage.texts, text), screen.figmaPage.hash, screen.path, deps.ignores));
    checks.push(...docsMismatchChecks(screen.rules, screen.figma.texts, text, deps.ignores));
  }
  const situational = situationalRules(screen.rules, screen.path).length;
  try {
    const judged = await judge(screen, text, screenHash, screenChanged, driver, deps);
    return { path: screen.path, checks: [...checks, ...judged.checks], situational, cached: judged.cached, judgeError: judged.judgeError, figmaCoverage: coverage };
  } catch (error) {
    return { path: screen.path, checks, situational, cached: false, judgeError: error instanceof Error ? error.message : String(error), figmaCoverage: coverage };
  }
}

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { ScreenDriver } from "@device-farm/core/device/driver";
import { samePath } from "@device-farm/core/device/screen-ready";
import {
  compareCopyRules,
  diffFigmaCopy,
  docsMismatchChecks,
  figmaChecks,
  rulesForScreen,
  screenTextHash,
  situationalRules,
  type PolicyCheck,
  type PolicyIgnore,
} from "@device-farm/core/policy/compare";
import { isSensitivePath, judgeKey, judgePrompt, parseVerdicts, verdictChecks } from "@device-farm/core/policy/judge";
import { screenMatches, shortHash, type PageRules, type PolicyRule } from "@device-farm/core/policy/rules";
import { sleep } from "@device-farm/core/sleep";

import type { AskClaude } from "./claude";
import type { FigmaTexts } from "./figma";
import { readJudgeCache, readScreenHashes, writeJudgeCache, writeScreenHashes } from "./rules-store";
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
}

/**
 * 규칙·피그마가 걸린 화면 목록. `*`가 든 경로는 열 수 없으니 그 패턴에 맞는 구체 경로(화면 지도·시나리오)로 펼친다.
 * 피그마 문구는 그 화면을 다루는 정책들의 노드를 합친다.
 */
export function policyScreens(
  pages: readonly PageRules[],
  knownPaths: readonly string[],
  figmaCache: Record<string, FigmaTexts>,
  frontRoutes: Record<string, string[]> = {},
): PolicyScreen[] {
  const concrete = (pattern: string) => (pattern.includes("*") ? knownPaths.filter((known) => screenMatches(pattern, known)) : [pattern]);
  const paths = new Set(pages.flatMap((page) => [...page.screens, ...page.rules.flatMap((rule) => rule.screens)].flatMap(concrete)));
  const allRules = pages.flatMap((page) => page.rules);
  return [...paths].sort().map((screen) => {
    // 정책 본문에 적힌 노드 + 프론트 코드(스토리북·주석)가 이 화면에 단 노드
    const refs = new Set([
      ...pages.filter((page) => page.screens.some((pattern) => screenMatches(pattern, screen))).flatMap((page) => page.figma),
      ...Object.entries(frontRoutes).flatMap(([route, routeRefs]) => (screenMatches(route, screen) ? routeRefs : [])),
    ]);
    const figmaTexts = [...refs].sort().flatMap((ref) => (figmaCache[ref] ? [figmaCache[ref]] : []));
    const texts = figmaTexts.flatMap((item) => item.texts);
    return { path: screen, rules: rulesForScreen(allRules, screen), figma: texts.length > 0 ? { hash: shortHash(figmaTexts.map((item) => item.hash).join(",")), texts } : null };
  });
}

export interface PolicyCheckDeps {
  ask: AskClaude | null;
  ignores: readonly PolicyIgnore[];
  now?: () => number;
  root?: string;
  settleMs?: number;
}

async function judge(screen: PolicyScreen, text: string, screenHash: string, screenChanged: boolean, driver: ScreenDriver, deps: PolicyCheckDeps) {
  const root = deps.root ?? policyRoot;
  const behaviors = screen.rules.filter((rule) => rule.kind === "behavior");
  const context = { ignores: deps.ignores, screenChanged, now: deps.now?.() ?? Date.now() };
  if (behaviors.length === 0) return { checks: [], cached: false };
  const key = judgeKey(screen.path, screenHash, behaviors, screen.figma?.hash ?? "");
  const cache = readJudgeCache(root);
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
  writeJudgeCache({ ...readJudgeCache(root), [key]: verdicts }, root);
  return { checks: verdictChecks(behaviors, verdicts, context), cached: false };
}

/** 화면을 열고 문구 규칙·피그마 문구·화면 동작 판정을 돌린다. 판정이 실패해도 글자 비교 결과는 남긴다 */
export async function checkPolicyScreen(driver: ScreenDriver, screen: PolicyScreen, deps: PolicyCheckDeps): Promise<PolicyScreenReport> {
  const root = deps.root ?? policyRoot;
  // 앱을 막 연 직후 딥링크가 홈으로 떨어진 적이 있어 한 번 더 연다
  let opened = "";
  for (let attempt = 0; attempt < policyOpenAttempts && !samePath(screen.path, opened); attempt += 1) {
    await driver.navigate(screen.path);
    await sleep(deps.settleMs ?? policySettleMs);
    opened = await driver.currentPath();
  }
  if (!samePath(screen.path, opened)) {
    return { path: screen.path, situational: 0, cached: false, checks: [{ id: "open", title: "화면 열기", ok: false, message: `${screen.path} 대신 ${opened} 화면이 열려 있습니다.`, ignoreKey: "open", ignoreHash: "" }] };
  }
  const text = await driver.evaluate<string>("document.body.innerText");
  const screenHash = screenTextHash(text);
  const hashes = readScreenHashes(root);
  const screenChanged = hashes[screen.path] !== undefined && hashes[screen.path] !== screenHash;
  writeScreenHashes({ ...hashes, [screen.path]: screenHash }, root);

  const now = deps.now?.() ?? Date.now();
  const checks: PolicyCheck[] = compareCopyRules(screen.rules, { path: screen.path, text, ignores: deps.ignores, screenChanged, now, figmaTexts: screen.figma?.texts ?? null });
  if (screen.figma) {
    checks.push(...figmaChecks(diffFigmaCopy(screen.figma.texts, text), screen.figma.hash, screen.path, deps.ignores));
    checks.push(...docsMismatchChecks(screen.rules, screen.figma.texts, text, deps.ignores));
  }
  const situational = situationalRules(screen.rules, screen.path).length;
  try {
    const judged = await judge(screen, text, screenHash, screenChanged, driver, deps);
    return { path: screen.path, checks: [...checks, ...judged.checks], situational, cached: judged.cached, judgeError: judged.judgeError };
  } catch (error) {
    return { path: screen.path, checks, situational, cached: false, judgeError: error instanceof Error ? error.message : String(error) };
  }
}

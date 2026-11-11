import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { PolicyIgnore } from "@device-farm/core/policy/compare";
import type { Verdict } from "@device-farm/core/policy/judge";
import type { PageRules } from "@device-farm/core/policy/rules";

import type { FigmaTexts } from "./figma";
import { policyRoot } from "./store";

/** 무시 목록. 레포에 커밋한다(설계 문서 「무시」) */
export const ignoredFile = path.resolve("policy/ignored.json");

const rulesDir = (root: string) => path.join(root, "rules");
const figmaFile = (root: string) => path.join(root, "figma.json");
const judgeFile = (root: string) => path.join(root, "judge-cache.json");
const screensFile = (root: string) => path.join(root, "screens.json");

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    // 처음이면 파일이 없다. 빈 값과 같다.
    return fallback;
  }
}

/** 임시 파일에 쓰고 바꿔 끼워 반쯤 쓴 파일을 남기지 않는다 */
export function writeJsonFile(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temp, file);
}

export function readPageRules(pageId: string, root = policyRoot): PageRules | null {
  return readJson<PageRules | null>(path.join(rulesDir(root), `${pageId}.json`), null);
}

export function writePageRules(rules: PageRules, root = policyRoot): void {
  writeJsonFile(path.join(rulesDir(root), `${rules.pageId}.json`), rules);
}

export function removePageRules(pageId: string, root = policyRoot): void {
  rmSync(path.join(rulesDir(root), `${pageId}.json`), { force: true });
}

export function readAllPageRules(root = policyRoot): PageRules[] {
  if (!existsSync(rulesDir(root))) return [];
  return readdirSync(rulesDir(root))
    .filter((name) => name.endsWith(".json"))
    .flatMap((name) => {
      const rules = readJson<PageRules | null>(path.join(rulesDir(root), name), null);
      return rules ? [rules] : [];
    });
}

export function readIgnores(file = ignoredFile): PolicyIgnore[] {
  const parsed = readJson<{ items?: PolicyIgnore[] }>(file, {});
  return Array.isArray(parsed.items) ? parsed.items : [];
}

/** 같은 키·해시면 이유만 바꾼다 */
export function addIgnore(item: PolicyIgnore, file = ignoredFile): void {
  const items = readIgnores(file).filter((existing) => !(existing.key === item.key && existing.hash === item.hash));
  writeJsonFile(file, { items: [...items, item] });
}

export function removeIgnore(key: string, hash: string, file = ignoredFile): void {
  writeJsonFile(file, { items: readIgnores(file).filter((item) => !(item.key === key && item.hash === hash)) });
}

export const readFigmaCache = (root = policyRoot) => readJson<Record<string, FigmaTexts>>(figmaFile(root), {});
export const writeFigmaCache = (cache: Record<string, FigmaTexts>, root = policyRoot) => writeJsonFile(figmaFile(root), cache);

export const readJudgeCache = (root = policyRoot) => readJson<Record<string, Verdict[]>>(judgeFile(root), {});
export const writeJudgeCache = (cache: Record<string, Verdict[]>, root = policyRoot) => writeJsonFile(judgeFile(root), cache);

/** 화면 경로 → 지난 점검의 화면 글자 해시 */
export const readScreenHashes = (root = policyRoot) => readJson<Record<string, string>>(screensFile(root), {});
export const writeScreenHashes = (hashes: Record<string, string>, root = policyRoot) => writeJsonFile(screensFile(root), hashes);

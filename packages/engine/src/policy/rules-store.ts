import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { PolicyIgnore } from "@device-farm/core/policy/compare";
import type { Verdict } from "@device-farm/core/policy/judge";
import type { PageRules } from "@device-farm/core/policy/rules";

import { all, farmDb, fromJson, get, readMeta, run as sql, transaction, writeMeta, type FarmDb } from "../db/farm-db";

import type { FigmaTexts } from "./figma";

/** 무시 목록. 레포에 커밋한다(설계 문서 「무시」). 같이 쓰는 파일이라 farm.db로 옮기지 않는다 */
export const ignoredFile = path.resolve("policy/ignored.json");

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

type RulesRow = { page_id: string; data: string };

const parseRules = (row: RulesRow) => fromJson<PageRules>(row.data, `policy_rules(${row.page_id})`);

export function readPageRules(pageId: string, db: FarmDb = farmDb()): PageRules | null {
  const row = get<RulesRow>(db, "SELECT page_id, data FROM policy_rules WHERE page_id = ?", pageId);
  return row ? parseRules(row) : null;
}

export function writePageRules(rules: PageRules, db: FarmDb = farmDb()): void {
  sql(
    db,
    `INSERT INTO policy_rules (page_id, page_title, page_hash, extracted_at, data) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (page_id) DO UPDATE SET page_title = excluded.page_title, page_hash = excluded.page_hash, extracted_at = excluded.extracted_at, data = excluded.data`,
    rules.pageId,
    rules.pageTitle,
    rules.pageHash,
    rules.extractedAt,
    JSON.stringify(rules),
  );
}

export function removePageRules(pageId: string, db: FarmDb = farmDb()): void {
  sql(db, "DELETE FROM policy_rules WHERE page_id = ?", pageId);
}

/** 페이지 id 순 */
export function readAllPageRules(db: FarmDb = farmDb()): PageRules[] {
  return all<RulesRow>(db, "SELECT page_id, data FROM policy_rules ORDER BY page_id").map(parseRules);
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

/** 키 → JSON 값 캐시 표(피그마 문구·판정). 쓰기는 통째로 바꾼다(호출자가 읽고 합쳐서 넘긴다). */
type CacheTable = "policy_figma_cache" | "policy_judge_cache";
const cacheKeyColumn: Record<CacheTable, string> = { policy_figma_cache: "ref", policy_judge_cache: "key" };

function readCache<T>(table: CacheTable, db: FarmDb): Record<string, T> {
  const key = cacheKeyColumn[table];
  const rows = all<{ key: string; data: string }>(db, `SELECT ${key} AS key, data FROM ${table} ORDER BY rowid`);
  return Object.fromEntries(rows.map((row) => [row.key, fromJson<T>(row.data, `${table}(${row.key})`)]));
}

function writeCache(table: CacheTable, cache: Record<string, unknown>, db: FarmDb): void {
  const key = cacheKeyColumn[table];
  transaction(db, () => {
    sql(db, `DELETE FROM ${table}`);
    const insert = db.prepare(`INSERT INTO ${table} (${key}, data) VALUES (?, ?)`);
    for (const [name, value] of Object.entries(cache)) insert.run(name, JSON.stringify(value));
  });
}

export const readFigmaCache = (db: FarmDb = farmDb()) => readCache<FigmaTexts>("policy_figma_cache", db);
export const writeFigmaCache = (cache: Record<string, FigmaTexts>, db: FarmDb = farmDb()) => writeCache("policy_figma_cache", cache, db);

/** 피그마 페이지 문구는 노드 문구와 같은 표에 이 앞머리로 둔다(`page:fileKey:pageId`) */
export const figmaPageKey = (pageRef: string) => `page:${pageRef}`;

/** 노드(`fileKey:nodeId`) → 그 노드가 있는 페이지(`fileKey:pageId`). farm.db `farm_meta` `figma.pageOf` */
export function readFigmaPageOf(db: FarmDb = farmDb()): Record<string, string> {
  const raw = readMeta(db, "figma.pageOf");
  return raw ? fromJson<Record<string, string>>(raw, "farm_meta(figma.pageOf)") : {};
}

export function writeFigmaPageOf(pageOf: Record<string, string>, db: FarmDb = farmDb()): void {
  writeMeta(db, "figma.pageOf", JSON.stringify(pageOf));
}

export const readJudgeCache = (db: FarmDb = farmDb()) => readCache<Verdict[]>("policy_judge_cache", db);
export const writeJudgeCache = (cache: Record<string, Verdict[]>, db: FarmDb = farmDb()) => writeCache("policy_judge_cache", cache, db);

/** 화면 경로 → 지난 점검의 화면 글자 해시 */
export function readScreenHashes(db: FarmDb = farmDb()): Record<string, string> {
  return Object.fromEntries(all<{ path: string; hash: string }>(db, "SELECT path, hash FROM policy_screen_hashes ORDER BY rowid").map((row) => [row.path, row.hash]));
}

export function writeScreenHashes(hashes: Record<string, string>, db: FarmDb = farmDb()): void {
  transaction(db, () => {
    sql(db, "DELETE FROM policy_screen_hashes");
    for (const [screen, hash] of Object.entries(hashes)) sql(db, "INSERT INTO policy_screen_hashes (path, hash) VALUES (?, ?)", screen, hash);
  });
}

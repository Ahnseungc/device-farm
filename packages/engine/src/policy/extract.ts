import { buildPageRules, extractPrompt, parseExtraction, storageToText } from "@device-farm/core/policy/rules";
import type { PolicySnapshot } from "@device-farm/core/policy/snapshot";

import type { FarmDb } from "../db/farm-db";

import type { AskClaude } from "./claude";
import { readPolicyPageWithBody, type ConfluenceConfig, type FetchLike } from "./confluence";
import { figmaRefs } from "./figma";
import { readAllPageRules, readPageRules, removePageRules, writePageRules } from "./rules-store";

export interface RefreshDeps {
  config: ConfluenceConfig;
  ask: AskClaude;
  fetchImpl: FetchLike;
  /** Claude가 고를 화면 경로 목록 */
  knownScreens: readonly string[];
  /** 프롬프트에 넣을 앱 이름(`AppConfig.name`) */
  appName?: string;
  log: (message: string) => void;
  now?: () => Date;
  /** 규칙 저장 DB. 없으면 farm.db */
  db?: FarmDb;
  /** 진행 표시: 몇 번째 페이지를 뽑는 중인지 */
  onProgress?: (done: number, total: number) => void;
  /** 디바이스팜 「중지」. 지금 정책을 마치고 남은 정책은 다음 확인 때 뽑는다 */
  signal?: AbortSignal;
}

export interface RefreshResult {
  extracted: number;
  removed: number;
  failed: { id: string; message: string }[];
}

/** 규칙이 없거나 뽑을 때와 본문 해시가 다른 페이지 */
export const pagesToExtract = (snapshot: PolicySnapshot, db?: FarmDb) => Object.values(snapshot.pages).filter((page) => readPageRules(page.id, db)?.pageHash !== page.hash);

/** 페이지 하나를 다시 뽑아 규칙을 통째로 바꾼다 */
export async function extractPage(pageId: string, deps: RefreshDeps): Promise<void> {
  const { db } = deps;
  const { page, storage } = await readPolicyPageWithBody(deps.config, pageId, deps.fetchImpl);
  const bodyText = storageToText(storage);
  const { screens, candidates } = parseExtraction(await deps.ask(extractPrompt(page.title, bodyText, deps.knownScreens, deps.appName)));
  const { rules, dropped } = buildPageRules(page, bodyText, candidates, readPageRules(page.id, db)?.rules ?? []);
  writePageRules(
    { pageId: page.id, pageTitle: page.title, pageHash: page.hash, extractedAt: (deps.now?.() ?? new Date()).toISOString(), screens, figma: figmaRefs(storage), rules, dropped },
    db,
  );
  deps.log(`정책 규칙 「${page.title}」 ${rules.length}개 · 버림 ${dropped.length}개`);
}

/**
 * 바뀐 페이지만 다시 뽑는다(설계 문서 「바뀜 감지」). 한 번에 하나씩(Claude 호출이 길다). 한 페이지가 실패해도 나머지는 뽑는다.
 * 스냅샷에서 사라진 페이지의 규칙은 지운다.
 */
export async function refreshRules(snapshot: PolicySnapshot, deps: RefreshDeps): Promise<RefreshResult> {
  const { db } = deps;
  const targets = pagesToExtract(snapshot, db);
  const failed: RefreshResult["failed"] = [];
  let extracted = 0;
  for (const [index, page] of targets.entries()) {
    if (deps.signal?.aborted) break;
    deps.onProgress?.(index, targets.length);
    try {
      await extractPage(page.id, deps);
      extracted += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failed.push({ id: page.id, message });
      deps.log(`정책 규칙 뽑기 실패 「${page.title}」: ${message}`);
    }
  }
  const stale = readAllPageRules(db).filter((rules) => !snapshot.pages[rules.pageId]);
  for (const rules of stale) removePageRules(rules.pageId, db);
  return { extracted, removed: stale.length, failed };
}

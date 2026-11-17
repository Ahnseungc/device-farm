import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { diffSnapshots, emptySnapshot, type PolicyChange, type PolicyChangeRecord, type PolicyPage, type PolicySnapshot } from "@device-farm/core/policy/snapshot";

import { all, farmDb, readMeta, run as sql, transaction, writeMeta, type FarmDb } from "../db/farm-db";

/** 레포 루트 `policy/sources.json`: 검색 밖 정책 페이지 등록, 화면·피그마 연결(커밋한다) */
export const sourcesFile = path.resolve("policy/sources.json");
/** 판정 스크린샷·front-figma 지도 폴더(커밋하지 않는다). 스냅샷·바뀜·규칙·캐시는 farm.db */
export const policyRoot = path.resolve("test-results/policy");

export interface PolicySources {
  pages: { pageId: string; title?: string; screens?: string[]; figma?: string[] }[];
  /**
   * 테스트 경로 → 그 경로처럼 대조할 실제 화면. 정책 규칙·피그마 노드를 실제 화면 것으로 쓴다.
   * 예: `/dev/farm-sample`(정책과 일부러 다르게 만든 dev 전용 페이지) → `/benefit/level-guide`
   */
  screenAliases?: Record<string, string>;
}

export function readSources(file = sourcesFile): PolicySources {
  if (!existsSync(file)) return { pages: [] };
  const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<PolicySources>;
  const aliases = parsed.screenAliases && typeof parsed.screenAliases === "object" ? parsed.screenAliases : {};
  return { pages: Array.isArray(parsed.pages) ? parsed.pages : [], screenAliases: aliases };
}

const checkedAtKey = "policy.checkedAt";

type PageRow = { page_id: string; title: string; version: number; modified_at: string; hash: string; web_url: string };

/** 처음 돌리면 스냅샷이 없다. 모든 정책이 "추가"로 잡힌다. */
export function readSnapshot(db: FarmDb = farmDb()): PolicySnapshot {
  const checkedAt = readMeta(db, checkedAtKey);
  if (checkedAt === null) return emptySnapshot;
  const pages = all<PageRow>(db, "SELECT page_id, title, version, modified_at, hash, web_url FROM policy_pages ORDER BY rowid").map(
    (row): PolicyPage => ({ id: row.page_id, title: row.title, version: row.version, modifiedAt: row.modified_at, hash: row.hash, webUrl: row.web_url }),
  );
  return { checkedAt, pages: Object.fromEntries(pages.map((page) => [page.id, page])) };
}

/** 스냅샷만 통째로 바꾼다(바뀜 기록 없이) */
export function writeSnapshot(snapshot: PolicySnapshot, db: FarmDb = farmDb()): void {
  transaction(db, () => {
    sql(db, "DELETE FROM policy_pages");
    for (const page of Object.values(snapshot.pages)) {
      sql(db, "INSERT INTO policy_pages (page_id, title, version, modified_at, hash, web_url) VALUES (?, ?, ?, ?, ?, ?)", page.id, page.title, page.version, page.modifiedAt, page.hash, page.webUrl);
    }
    writeMeta(db, checkedAtKey, snapshot.checkedAt);
  });
}

/** 새 스냅샷으로 통째로 바꾸고 바뀜을 기록에 붙인다. 바뀐 것을 돌려준다. */
export function recordSnapshot(next: PolicySnapshot, db: FarmDb = farmDb()): PolicyChange[] {
  return transaction(db, () => {
    const changes = diffSnapshots(readSnapshot(db), next);
    writeSnapshot(next, db);
    for (const change of changes) {
      insertChange(db, { at: next.checkedAt, kind: change.kind, id: change.page.id, title: change.page.title, version: change.page.version, fromVersion: change.before?.version, hash: change.page.hash });
    }
    return changes;
  });
}

/** 바뀜 한 줄. 같은 시각·종류·페이지·해시는 한 번만 남는다(가져오기를 다시 돌려도 안 겹친다). 넣었으면 true */
export function insertChange(db: FarmDb, record: PolicyChangeRecord): boolean {
  return (
    sql(
      db,
      "INSERT OR IGNORE INTO policy_changes (at, kind, page_id, title, version, from_version, hash) VALUES (?, ?, ?, ?, ?, ?, ?)",
      record.at,
      record.kind,
      record.id,
      record.title,
      record.version,
      record.fromVersion ?? null,
      record.hash,
    ) > 0
  );
}

type ChangeRow = { at: string; kind: PolicyChangeRecord["kind"]; page_id: string; title: string; version: number; from_version: number | null; hash: string };

/** 바뀜 기록 최근 limit개(최신 먼저) */
export function readChanges(limit: number, db: FarmDb = farmDb()): PolicyChangeRecord[] {
  return all<ChangeRow>(db, "SELECT at, kind, page_id, title, version, from_version, hash FROM policy_changes ORDER BY id DESC LIMIT ?", limit).map((row) => {
    const record: PolicyChangeRecord = { at: row.at, kind: row.kind, id: row.page_id, title: row.title, version: row.version, hash: row.hash };
    if (row.from_version !== null) record.fromVersion = row.from_version;
    return record;
  });
}

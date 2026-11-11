import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

import { diffSnapshots, emptySnapshot, type PolicyChange, type PolicyChangeRecord, type PolicySnapshot } from "@device-farm/core/policy/snapshot";

/** 레포 루트 `policy/sources.json`: 검색 밖 정책 페이지 등록, 화면·피그마 연결(커밋한다) */
export const sourcesFile = path.resolve("policy/sources.json");
/** 마지막 스냅샷과 바뀜 기록(커밋하지 않는다) */
export const policyRoot = path.resolve("test-results/policy");

export interface PolicySources {
  pages: { pageId: string; title?: string; screens?: string[]; figma?: string[] }[];
}

export function readSources(file = sourcesFile): PolicySources {
  if (!existsSync(file)) return { pages: [] };
  const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<PolicySources>;
  return { pages: Array.isArray(parsed.pages) ? parsed.pages : [] };
}

const snapshotFile = (root: string) => path.join(root, "snapshot.json");
const changesFile = (root: string) => path.join(root, "changes.jsonl");

export function readSnapshot(root = policyRoot): PolicySnapshot {
  try {
    return JSON.parse(readFileSync(snapshotFile(root), "utf8")) as PolicySnapshot;
  } catch {
    // 처음 돌리면 스냅샷이 없다. 모든 정책이 "추가"로 잡힌다.
    return emptySnapshot;
  }
}

/** 새 스냅샷을 저장하고 바뀜을 기록에 붙인다. 바뀐 것을 돌려준다. 임시 파일에 쓰고 바꿔 끼운다. */
export function recordSnapshot(next: PolicySnapshot, root = policyRoot): PolicyChange[] {
  const changes = diffSnapshots(readSnapshot(root), next);
  mkdirSync(root, { recursive: true });
  const temp = `${snapshotFile(root)}.tmp`;
  writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`);
  renameSync(temp, snapshotFile(root));
  const lines = changes.map((change) => {
    const record: PolicyChangeRecord = { at: next.checkedAt, kind: change.kind, id: change.page.id, title: change.page.title, version: change.page.version, fromVersion: change.before?.version, hash: change.page.hash };
    return JSON.stringify(record);
  });
  if (lines.length > 0) appendFileSync(changesFile(root), `${lines.join("\n")}\n`);
  return changes;
}

/** 바뀜 기록 최근 limit개(최신 먼저). 깨진 줄은 건너뛴다. */
export function readChanges(limit: number, root = policyRoot): PolicyChangeRecord[] {
  if (!existsSync(changesFile(root))) return [];
  const records = readFileSync(changesFile(root), "utf8")
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as PolicyChangeRecord];
      } catch {
        // 쓰다 끊긴 줄 하나 때문에 전체를 버리지 않는다.
        return [];
      }
    });
  return records.slice(-limit).reverse();
}

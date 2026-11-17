import type { NightlyKind } from "@device-farm/core/nightly/schedule";

import { farmDb, readMeta, writeMeta, type FarmDb } from "./db/farm-db";

/** 야간 점검 칸 하나를 마지막으로 처리한 기록(farm.db `farm_meta` `nightly.<kind>`) */
export interface NightlyRecord {
  /** 처리한 예정 시각 */
  scheduledAt: string;
  /** 돌았는가, 건너뛰었는가 */
  result: "started" | "skipped";
  /** 건너뛴 이유·시작한 실행 id */
  note: string;
  at: string;
}

const key = (kind: NightlyKind) => `nightly.${kind}`;

export function readNightly(kind: NightlyKind, db: FarmDb = farmDb()): NightlyRecord | null {
  const raw = readMeta(db, key(kind));
  return raw ? (JSON.parse(raw) as NightlyRecord) : null;
}

export function writeNightly(kind: NightlyKind, record: NightlyRecord, db: FarmDb = farmDb()): void {
  writeMeta(db, key(kind), JSON.stringify(record));
}

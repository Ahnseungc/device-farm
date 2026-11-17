import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

import { migrations } from "./schema";

/**
 * 디바이스팜 기록 DB(SQLite 파일 하나). 점검·봇 점검 실행, 정책 스냅샷·규칙·캐시, 슬랙 알림, 화면 지도를 담는다.
 * 스크린샷·영상·로그·기준 PNG는 파일로 두고 경로만 적는다. 백업은 `cp test-results/farm.db`.
 */
export type FarmDb = DatabaseSync;

const memory = ":memory:";
/** 다른 프로세스(CLI·서버)가 쓰는 중이면 기다리는 시간 (작성자 판단) */
const busyTimeoutMs = 5000;

/** `FARM_DB`로 바꿀 수 있다(테스트·다른 체크아웃). */
export const farmDbFile = path.resolve(process.env.FARM_DB?.trim() || "test-results/farm.db");

/** 아직 안 돌린 마이그레이션을 차례로 돌린다. 각 단계는 트랜잭션 하나다. */
function migrate(db: FarmDb): void {
  const row = db.prepare("PRAGMA user_version").get() as { user_version: number } | undefined;
  const current = row?.user_version ?? 0;
  if (current > migrations.length) throw new Error(`farm.db 버전 ${current}이 코드(${migrations.length})보다 새롭습니다. 코드를 최신으로 받으세요.`);
  for (let version = current; version < migrations.length; version += 1) {
    transaction(db, () => {
      db.exec(migrations[version]);
      db.exec(`PRAGMA user_version = ${version + 1}`);
    });
  }
}

/** 파일을 열고(없으면 만든다) WAL·외래 키를 켠 뒤 스키마를 맞춘다. 테스트는 `:memory:`. */
export function openFarmDb(file = farmDbFile): FarmDb {
  if (file !== memory) mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  try {
    if (file !== memory) db.exec("PRAGMA journal_mode = WAL");
    db.exec(`PRAGMA busy_timeout = ${busyTimeoutMs}; PRAGMA foreign_keys = ON;`);
    migrate(db);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

let shared: FarmDb | null = null;

/** 프로세스에서 같이 쓰는 연결. 처음 부를 때 연다. */
export function farmDb(): FarmDb {
  shared ??= openFarmDb();
  return shared;
}

/** 테스트·가져오기 스크립트가 다른 DB를 쓰게 바꾼다. 이전 연결은 닫지 않는다(호출자 몫). */
export function useFarmDb(db: FarmDb): void {
  shared = db;
}

/** fn을 트랜잭션으로 감싼다. 던지면 되돌린다. 이미 트랜잭션 안이면 그대로 돌린다. */
export function transaction<T>(db: FarmDb, fn: () => T): T {
  if (db.isTransaction) return fn();
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function all<T>(db: FarmDb, sql: string, ...params: SQLInputValue[]): T[] {
  return db.prepare(sql).all(...params) as T[];
}

export function get<T>(db: FarmDb, sql: string, ...params: SQLInputValue[]): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined;
}

export function run(db: FarmDb, sql: string, ...params: SQLInputValue[]): number {
  return Number(db.prepare(sql).run(...params).changes);
}

/** 선택 값을 열에 넣는다. 없으면 NULL */
export const toJson = (value: unknown): string | null => (value === undefined ? null : JSON.stringify(value));

/** 우리가 쓴 JSON 열을 읽는다. 깨졌으면 어느 표인지 밝혀 던진다(조용히 빼면 기록이 사라진 것처럼 보인다). */
export function fromJson<T>(text: string, where: string): T {
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw new Error(`farm.db ${where} JSON을 읽지 못했습니다: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** `farm_meta` 키-값 */
export function readMeta(db: FarmDb, key: string): string | null {
  return get<{ value: string }>(db, "SELECT value FROM farm_meta WHERE key = ?", key)?.value ?? null;
}

export function writeMeta(db: FarmDb, key: string, value: string): void {
  run(db, "INSERT INTO farm_meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value", key, value);
}

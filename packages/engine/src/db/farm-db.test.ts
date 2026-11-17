import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { all, get, openFarmDb, readMeta, run, transaction, writeMeta } from "./farm-db";
import { migrations } from "./schema";

// 새 파일: WAL로 열고 스키마를 끝까지 올린다. 다시 열어도 마이그레이션을 또 돌리지 않는다
{
  const dir = mkdtempSync(path.join(tmpdir(), "farm-db-"));
  try {
    const file = path.join(dir, "nested", "farm.db");
    const db = openFarmDb(file);
    assert.equal(get<{ journal_mode: string }>(db, "PRAGMA journal_mode")?.journal_mode, "wal");
    assert.equal(get<{ user_version: number }>(db, "PRAGMA user_version")?.user_version, migrations.length);
    writeMeta(db, "k", "1");
    db.close();
    const again = openFarmDb(file);
    assert.equal(readMeta(again, "k"), "1");
    again.close();

    // 코드보다 새 DB는 열지 않는다
    const newer = openFarmDb(file);
    newer.exec(`PRAGMA user_version = ${migrations.length + 1}`);
    newer.close();
    assert.throws(() => openFarmDb(file), /코드를 최신으로/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// 트랜잭션: 던지면 되돌리고, 안쪽 트랜잭션은 바깥에 합친다
{
  const db = openFarmDb(":memory:");
  assert.throws(() =>
    transaction(db, () => {
      writeMeta(db, "a", "1");
      transaction(db, () => writeMeta(db, "b", "2"));
      throw new Error("boom");
    }),
  );
  assert.deepEqual(all(db, "SELECT key FROM farm_meta"), []);
  assert.equal(run(db, "INSERT INTO farm_meta (key, value) VALUES ('x', 'y')"), 1);
  assert.equal(db.isTransaction, false);
  db.close();
}

console.log("farm-db ok");

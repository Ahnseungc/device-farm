import { createHash, randomBytes } from "node:crypto";

import { readMeta, run, get, writeMeta, type FarmDb } from "@device-farm/engine/db/farm-db";

/**  */
export const sessionTtlMs = 7 * 24 * 60 * 60 * 1000;
const sessionIdBytes = 32;
const passwordDigestKey = "auth.passwordHashDigest";

export interface SessionStore {
  /** 새 세션을 만들고 쿠키에 넣을 id 원문을 돌려준다 */
  create(ip: string, now?: Date): string;
  valid(id: string, now?: Date): boolean;
  remove(id: string): void;
  /** 만료된 세션을 지우고 지운 수를 돌려준다 */
  prune(now?: Date): number;
  /** 비밀번호 해시가 지난번과 다르면 세션을 전부 지우고 true */
  resetIfPasswordChanged(passwordHash: string): boolean;
}

const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

/** 쿠키 값 모양(32바이트 base64url = 43자)이 아니면 DB를 보지 않는다 */
const idPattern = /^[A-Za-z0-9_-]{43}$/;

export function dbSessionStore(db: FarmDb): SessionStore {
  return {
    create(ip, now = new Date()) {
      const id = randomBytes(sessionIdBytes).toString("base64url");
      const expires = new Date(now.getTime() + sessionTtlMs);
      run(db, "INSERT INTO farm_sessions (id_hash, created_at, expires_at, ip) VALUES (?, ?, ?, ?)", sha256(id), now.toISOString(), expires.toISOString(), ip);
      return id;
    },
    valid(id, now = new Date()) {
      if (!idPattern.test(id)) return false;
      const row = get<{ expires_at: string }>(db, "SELECT expires_at FROM farm_sessions WHERE id_hash = ?", sha256(id));
      return Boolean(row && Date.parse(row.expires_at) > now.getTime());
    },
    remove(id) {
      if (idPattern.test(id)) run(db, "DELETE FROM farm_sessions WHERE id_hash = ?", sha256(id));
    },
    prune(now = new Date()) {
      return run(db, "DELETE FROM farm_sessions WHERE expires_at <= ?", now.toISOString());
    },
    resetIfPasswordChanged(passwordHash) {
      const digest = sha256(passwordHash.trim());
      const before = readMeta(db, passwordDigestKey);
      if (before === digest) return false;
      run(db, "DELETE FROM farm_sessions");
      writeMeta(db, passwordDigestKey, digest);
      return before !== null;
    },
  };
}

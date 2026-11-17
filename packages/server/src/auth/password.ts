import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

/**
 * 팀 비밀번호 scrypt 해시. 서버에는 해시만 둔다.
 * 형식: `scrypt$<N>$<r>$<p>$<salt base64url>$<key base64url>`
 */
export const scryptCost = 2 ** 15;
export const scryptBlockSize = 8;
export const scryptParallelization = 1;
export const saltBytes = 16;
export const keyBytes = 64;
/** 8자 (작성자 판단, 2026-11-16). 사내망 안에서만 열리고 5번 틀리면 15분 잠기므로 짧아도 무작위면 충분하다 */
export const minPasswordLength = 8;
/** N=2^15, r=8이면 32MiB가 필요하다. 노드 기본 한도(32MiB)에 걸리므로 넉넉히 둔다 */
const scryptMaxMem = 128 * 1024 * 1024;
/** 해시 문자열의 비용 값이 이보다 크면 받지 않는다(잘못된 값으로 서버가 멈추지 않게) */
const maxCost = 2 ** 20;
const prefix = "scrypt";

function derive(password: string, salt: Buffer, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize("NFC"), salt, keyBytes, { ...options, maxmem: scryptMaxMem }, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

export async function hashPassword(password: string, salt: Buffer = randomBytes(saltBytes)): Promise<string> {
  const key = await derive(password, salt, { N: scryptCost, r: scryptBlockSize, p: scryptParallelization });
  return [prefix, scryptCost, scryptBlockSize, scryptParallelization, salt.toString("base64url"), key.toString("base64url")].join("$");
}

interface ParsedHash {
  options: ScryptOptions;
  salt: Buffer;
  key: Buffer;
}

function parseHash(stored: string): ParsedHash | null {
  const parts = stored.trim().split("$");
  if (parts.length !== 6 || parts[0] !== prefix) return null;
  const [N, r, p] = parts.slice(1, 4).map(Number);
  const powerOfTwo = Number.isInteger(N) && N > 1 && (N & (N - 1)) === 0;
  if (!powerOfTwo || N > maxCost || !Number.isInteger(r) || r < 1 || r > 32 || !Number.isInteger(p) || p < 1 || p > 16) return null;
  const salt = Buffer.from(parts[4], "base64url");
  const key = Buffer.from(parts[5], "base64url");
  if (salt.length < saltBytes || key.length !== keyBytes) return null;
  return { options: { N, r, p }, salt, key };
}

/** 해시 형식이 틀리면 false(예외를 던지지 않는다). 비교는 상수 시간. */
export async function verifyPassword(password: string, stored: string | undefined): Promise<boolean> {
  if (!stored) return false;
  const parsed = parseHash(stored);
  if (!parsed) return false;
  try {
    const key = await derive(password, parsed.salt, parsed.options);
    return timingSafeEqual(key, parsed.key);
  } catch {
    return false;
  }
}

export function validHashFormat(stored: string | undefined): boolean {
  return Boolean(stored && parseHash(stored));
}

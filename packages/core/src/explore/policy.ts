export const mutatingMethods = ["POST", "PUT", "PATCH", "DELETE"] as const;
export type MutatingMethod = (typeof mutatingMethods)[number];

/** 쓰기 판단 없이 통과시키는 메서드. 이 밖의 메서드(CONNECT, TRACE 등)는 쓰기로 본다. */
export const readMethods = ["GET", "HEAD", "OPTIONS"] as const;

export const allowlistStatuses = ["allow", "deny"] as const;
export type AllowlistStatus = (typeof allowlistStatuses)[number];

export interface AllowlistEntry {
  method: MutatingMethod;
  path: string;
  status: AllowlistStatus;
  note: string;
}

export interface Allowlist {
  entries: AllowlistEntry[];
}

export type BlockReason = "forbidden" | "not-allowed" | "unknown";
export type RequestDecision = { allow: true } | { allow: false; reason: BlockReason };

export interface WriteOperation {
  method: string;
  path: string;
}

import type { AllowedRequest } from "../config/app-config";

/** 가드 판단에 쓰는 앱 설정 일부(`AppConfig.guard`) */
export interface GuardRules {
  forbiddenApiPatterns: readonly RegExp[];
  pushTokenRequests: readonly AllowedRequest[];
}

const queryOrHash = /[?#].*$/;

/** 쿼리·해시를 떼고 경로만 남긴다. */
export function stripQuery(path: string): string {
  return path.replace(queryOrHash, "");
}

function safeDecode(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    // 잘못된 % 인코딩: 원문으로 판단한다. 금지 판단은 원문·디코딩 양쪽을 다 본다.
    return path;
  }
}

export function isForbiddenPath(path: string, patterns: readonly RegExp[]): boolean {
  const candidates = [path, safeDecode(path)];
  return patterns.some((pattern) => candidates.some((candidate) => pattern.test(candidate)));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const templateParam = /\{[^/{}]+\}/g;

/** `{x}`는 슬래시 없는 한 칸. 전체 일치만 본다. */
export function matchTemplate(template: string, path: string): boolean {
  const literals = template.split(templateParam).map(escapeRegExp);
  const source = literals.join("[^/]+");
  return new RegExp(`^${source}$`).test(path);
}

function isReadMethod(method: string): boolean {
  return (readMethods as readonly string[]).includes(method);
}

function findEntry(allowlist: Allowlist, method: string, path: string, status: AllowlistStatus): boolean {
  return allowlist.entries.some(
    (entry) => entry.status === status && entry.method.toUpperCase() === method && matchTemplate(entry.path, path),
  );
}

/**
 * 앱이 켜질 때마다 하는 요청(푸시 토큰 저장 등)은 디바이스팜 전체(점검·탐색·카오스)에서 막지 않는다.
 * 막으면 매번 콘솔 오류가 나고, 외부 주소(예: Firebase `accounts:...`)가 금지어에 걸려 허용 목록으로도 못 연다.
 */
const isPushTokenRequest = (rules: GuardRules, method: string, path: string) =>
  rules.pushTokenRequests.some((item) => item.method === method && matchTemplate(item.path, path));

/** 판단 순서: 읽기 → 앱 고정 요청 → 금지 경로 → allow → deny → 모름 */
export function decideRequest(method: string, path: string, allowlist: Allowlist, rules: GuardRules): RequestDecision {
  const upper = method.toUpperCase();
  if (isReadMethod(upper)) return { allow: true };
  const pathOnly = stripQuery(path);
  if (isPushTokenRequest(rules, upper, pathOnly)) return { allow: true };
  if (isForbiddenPath(pathOnly, rules.forbiddenApiPatterns)) return { allow: false, reason: "forbidden" };
  if (findEntry(allowlist, upper, pathOnly, "allow")) return { allow: true };
  if (findEntry(allowlist, upper, pathOnly, "deny")) return { allow: false, reason: "not-allowed" };
  return { allow: false, reason: "unknown" };
}

export function isMutatingMethod(method: string): method is MutatingMethod {
  return (mutatingMethods as readonly string[]).includes(method);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseEntry(value: unknown, index: number): AllowlistEntry {
  const where = `allowlist.entries[${index}]`;
  if (!isRecord(value)) throw new Error(`${where}: 객체가 아닙니다.`);
  const { method, path, status, note } = value;
  if (typeof method !== "string" || !isMutatingMethod(method)) throw new Error(`${where}.method: ${mutatingMethods.join("|")} 중 하나여야 합니다.`);
  if (typeof path !== "string" || !path.startsWith("/")) throw new Error(`${where}.path: "/"로 시작하는 문자열이어야 합니다.`);
  if (status !== "allow" && status !== "deny") throw new Error(`${where}.status: allow|deny 중 하나여야 합니다.`);
  if (note !== undefined && typeof note !== "string") throw new Error(`${where}.note: 문자열이어야 합니다.`);
  return { method, path, status, note: note ?? "" };
}

/** 모양이 틀리면 throw. 잘못된 목록으로 탐색을 시작하지 않는다. */
export function parseAllowlist(value: unknown): Allowlist {
  if (!isRecord(value) || !Array.isArray(value.entries)) throw new Error("allowlist: { entries: [] } 형식이 아닙니다.");
  return { entries: value.entries.map(parseEntry) };
}

function entryKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`;
}

/** 목록에 없는 쓰기 API만 deny로 덧붙인다. 기존 항목(allow 포함)은 그대로 둔다. */
export function addMissingAsDeny(
  allowlist: Allowlist,
  operations: readonly WriteOperation[],
): { allowlist: Allowlist; added: number } {
  const known = new Set(allowlist.entries.map((entry) => entryKey(entry.method, entry.path)));
  const added: AllowlistEntry[] = [];
  for (const operation of operations) {
    const method = operation.method.toUpperCase();
    const key = entryKey(method, operation.path);
    if (!isMutatingMethod(method) || known.has(key)) continue;
    known.add(key);
    added.push({ method, path: operation.path, status: "deny", note: "" });
  }
  return { allowlist: { entries: [...allowlist.entries, ...added] }, added: added.length };
}

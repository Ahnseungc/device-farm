/**
 * 정책 문서 바뀜 감지(docs/design-policy-figma.md). 문서마다 본문 해시를 남기고 지난 스냅샷과 비교한다.
 * 해시 계산과 Confluence 호출은 engine이 한다. 여기는 비교만 한다(LLM 없음).
 */

import type { DroppedCandidate, PolicyRule } from "./rules";

export interface PolicyPage {
  id: string;
  title: string;
  /** Confluence 버전 번호. 표시용(오타 수정에도 오른다) */
  version: number;
  /** 마지막 수정 시각(ISO). 표시용 */
  modifiedAt: string;
  /** 본문(storage) SHA-256. 바뀜 판정 기준 */
  hash: string;
  webUrl: string;
}

export interface PolicySnapshot {
  checkedAt: string;
  pages: Record<string, PolicyPage>;
}

export type PolicyChangeKind = "added" | "changed" | "removed";

export interface PolicyChange {
  kind: PolicyChangeKind;
  page: PolicyPage;
  /** changed일 때 이전 값 */
  before?: PolicyPage;
}

export const emptySnapshot: PolicySnapshot = { checkedAt: "", pages: {} };

/** 지난 스냅샷과 비교한다. 제목만 바뀐 것은 본문이 같으면 바뀜이 아니다. 결과는 제목 순 */
export function diffSnapshots(previous: PolicySnapshot, next: PolicySnapshot): PolicyChange[] {
  const changes: PolicyChange[] = [];
  for (const page of Object.values(next.pages)) {
    const before = previous.pages[page.id];
    if (!before) changes.push({ kind: "added", page });
    else if (before.hash !== page.hash) changes.push({ kind: "changed", page, before });
  }
  for (const page of Object.values(previous.pages)) {
    if (!next.pages[page.id]) changes.push({ kind: "removed", page });
  }
  return changes.sort((a, b) => a.page.title.localeCompare(b.page.title, "ko"));
}

/** 정책이 바뀐 지 이 기간 안에 생긴 규칙과의 어긋남은 "앱 반영 전"으로 본다 (작성자 판단) */
export const recentPolicyDays = 14;
const dayMs = 86_400_000;

export function isRecentlyChanged(page: Pick<PolicyPage, "modifiedAt">, now: number = Date.now()): boolean {
  const modified = Date.parse(page.modifiedAt);
  return Number.isFinite(modified) && now - modified < recentPolicyDays * dayMs;
}

/** 바뀜 기록 한 줄(`changes.jsonl`) */
export interface PolicyChangeRecord {
  at: string;
  kind: PolicyChangeKind;
  id: string;
  title: string;
  version: number;
  fromVersion?: number;
  hash: string;
}

/** 정책 페이지 하나의 뽑기 결과(디바이스팜 화면용) */
export interface PolicyRulesSummary {
  pageId: string;
  pageTitle: string;
  extractedAt: string;
  screens: string[];
  /** 본문에 적힌 피그마 노드 수 */
  figma: number;
  rules: PolicyRule[];
  dropped: DroppedCandidate[];
}

/** 디바이스팜 화면이 읽는 정책 감시 상태 */
export interface PolicyWatchState {
  /** Confluence 토큰이 .env에 있는가 */
  configured: boolean;
  figmaConfigured: boolean;
  running: boolean;
  /** 규칙 뽑는 중이면 몇 페이지 중 몇 번째 */
  progress: { done: number; total: number } | null;
  checkedAt: string | null;
  nextAt: string;
  /** 마지막 확인이 실패했으면 그 이유 */
  lastError: string | null;
  /** 마지막 확인에서 읽지 못한 페이지 */
  failed: { id: string; message: string }[];
  /** 마지막 뽑기에서 실패한 페이지 */
  extractFailed: { id: string; message: string }[];
  pages: PolicyPage[];
  changes: PolicyChangeRecord[];
  rules: PolicyRulesSummary[];
}

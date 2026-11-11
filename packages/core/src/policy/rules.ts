/**
 * 정책 본문에서 뽑은 규칙(docs/design-policy-figma.md 「정책에서 뽑는 것」). 사람이 확정하지 않는다.
 * Claude가 뽑은 후보는 근거 인용이 본문에 글자 그대로 있어야 남는다. 여기는 검증·병합만 한다(LLM 호출은 engine).
 */

import { recentPolicyDays } from "./snapshot";

/** copy: 안내 문구, value: 값 규칙, behavior: 화면 동작(판정 대상) */
export type PolicyRuleKind = "copy" | "value" | "behavior";

/** Claude가 돌려주는 규칙 후보 */
export interface RuleCandidate {
  kind: PolicyRuleKind;
  /** 정책 섹션 제목 */
  section: string;
  /** 사람이 읽을 규칙 한 줄 */
  statement: string;
  /** 화면에 그대로 보여야 하는 글자. copy는 필수, value는 있으면 */
  expected?: string;
  /** 정책 본문에서 그대로 가져온 문장·표 행 */
  evidence: string;
  /** 규칙이 보이는 화면 경로. `*`는 경로 한 마디 */
  screens: string[];
  /** 화면을 열기만 해도 보이는가. 토스트·모달·오류 상황 문구는 false */
  visibleOnOpen: boolean;
}

export interface PolicyRule extends RuleCandidate {
  id: string;
  pageId: string;
  pageTitle: string;
  /** 뽑을 때의 본문 해시 */
  pageHash: string;
  /** 이 규칙이 처음 생긴 정책 수정 시각(ISO). 14일 안이면 "앱 반영 전" */
  since: string;
}

export interface DroppedCandidate {
  statement: string;
  reason: string;
}

/** 페이지 하나의 뽑기 결과(`test-results/policy/rules/<pageId>.json`) */
export interface PageRules {
  pageId: string;
  pageTitle: string;
  pageHash: string;
  extractedAt: string;
  /** 이 정책이 다루는 화면(Claude가 화면 목록에서 고름) */
  screens: string[];
  /** 본문에 적힌 피그마 링크(`fileKey:nodeId`) */
  figma: string[];
  rules: PolicyRule[];
  dropped: DroppedCandidate[];
}

/** 공백·줄바꿈을 지워 비교한다 (데이터 QA `textHas`와 같은 기준) */
export const squash = (text: string) => text.replace(/\s+/g, "");

const entities: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/** Confluence storage(XHTML)를 읽을 글자로. 표 칸은 ` | `, 줄·문단·표 행은 줄바꿈 */
export function storageToText(storage: string): string {
  return storage
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|h[1-6]|li|tr|div)>/gi, "\n")
    .replace(/<\/(td|th)>/gi, " | ")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, code: string) => {
      if (code.startsWith("#x") || code.startsWith("#X")) return String.fromCodePoint(parseInt(code.slice(2), 16));
      if (code.startsWith("#")) return String.fromCodePoint(Number(code.slice(1)));
      return entities[code.toLowerCase()] ?? whole;
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 숫자 묶음(1,000 · 6 · 0.5). 값 규칙의 근거에 이 값이 다 있어야 한다 */
export const numbersIn = (text: string) => text.match(/\d[\d,.]*/g)?.map((value) => value.replace(/[,.]$/, "")) ?? [];

/** 후보를 버릴 이유. 남기면 null */
export function rejectReason(candidate: RuleCandidate, bodyText: string): string | null {
  const evidence = squash(candidate.evidence);
  if (!evidence) return "근거 인용이 비었습니다.";
  if (!squash(bodyText).includes(evidence)) return "근거 인용이 정책 본문에 없습니다.";
  if (candidate.kind === "copy" && (!candidate.expected || !evidence.includes(squash(candidate.expected)))) {
    return "안내 문구가 근거 인용에 없습니다.";
  }
  if (candidate.kind === "value") {
    const missing = numbersIn(candidate.expected ?? candidate.statement).filter((value) => !evidence.includes(squash(value)));
    if (missing.length > 0) return `값 ${missing.join(", ")}이 근거 인용에 없습니다.`;
  }
  return null;
}

/** 화면 경로 패턴. `*`는 경로 한 마디, 쿼리는 무시한다 */
export function screenMatches(pattern: string, path: string): boolean {
  const clean = (value: string) => value.split("?")[0].replace(/\/+$/, "") || "/";
  const parts = clean(pattern).split("/");
  const target = clean(path).split("/");
  return parts.length === target.length && parts.every((part, index) => part === "*" || part === target[index]);
}

/** FNV-1a 32비트. 캐시 키·규칙 id용(보안 해시 아님). 브라우저에서도 돈다 */
export function shortHash(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** 같은 근거·같은 기대 글자면 같은 규칙. 정책이 다시 바뀌어도 그대로 남은 규칙은 id와 `since`가 유지된다 */
export function ruleId(pageId: string, candidate: RuleCandidate): string {
  return `${pageId}-${candidate.kind}-${shortHash(`${squash(candidate.evidence)}\u0000${squash(candidate.expected ?? candidate.statement)}`)}`;
}

export interface PageInfo {
  id: string;
  title: string;
  hash: string;
  modifiedAt: string;
}

/**
 * 페이지 규칙을 통째로 바꾼다. 검증을 못 넘은 후보는 버린 목록으로, 이전에도 있던 규칙은 처음 생긴 시각을 이어 간다.
 * 근거가 새 본문에서 사라진 규칙은 후보에 없으므로 자연히 지워진다.
 */
export function buildPageRules(
  page: PageInfo,
  bodyText: string,
  candidates: readonly RuleCandidate[],
  previous: readonly PolicyRule[],
): { rules: PolicyRule[]; dropped: DroppedCandidate[] } {
  const sinceOf = new Map(previous.map((rule) => [rule.id, rule.since]));
  const rules = new Map<string, PolicyRule>();
  const dropped: DroppedCandidate[] = [];
  for (const candidate of candidates) {
    const reason = rejectReason(candidate, bodyText);
    if (reason) {
      dropped.push({ statement: candidate.statement, reason });
      continue;
    }
    const id = ruleId(page.id, candidate);
    rules.set(id, { ...candidate, id, pageId: page.id, pageTitle: page.title, pageHash: page.hash, since: sinceOf.get(id) ?? page.modifiedAt });
  }
  return { rules: [...rules.values()], dropped };
}

const kinds: readonly PolicyRuleKind[] = ["copy", "value", "behavior"];
const isString = (value: unknown): value is string => typeof value === "string";

function toCandidate(value: unknown): RuleCandidate | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (!kinds.includes(item.kind as PolicyRuleKind) || !isString(item.statement) || !isString(item.evidence)) return null;
  return {
    kind: item.kind as PolicyRuleKind,
    section: isString(item.section) ? item.section : "",
    statement: item.statement,
    expected: isString(item.expected) && item.expected.trim() ? item.expected : undefined,
    evidence: item.evidence,
    screens: Array.isArray(item.screens) ? item.screens.filter(isString) : [],
    visibleOnOpen: item.visibleOnOpen === true,
  };
}

/** 응답 글자에서 첫 JSON 객체를 꺼낸다(코드 펜스·설명 문장이 붙어도) */
export function parseJsonObject(text: string): Record<string, unknown> {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("응답에 JSON이 없습니다.");
  const parsed: unknown = JSON.parse(text.slice(start, end + 1));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("응답 JSON이 객체가 아닙니다.");
  return parsed as Record<string, unknown>;
}

/** 뽑기 응답 `{ screens, rules }`. 모양이 틀린 규칙은 건너뛴다 */
export function parseExtraction(text: string): { screens: string[]; candidates: RuleCandidate[] } {
  const parsed = parseJsonObject(text);
  const screens = Array.isArray(parsed.screens) ? parsed.screens.filter(isString) : [];
  const candidates = Array.isArray(parsed.rules) ? parsed.rules.map(toCandidate).filter((item): item is RuleCandidate => item !== null) : [];
  return { screens, candidates };
}

/** 정책 본문 길이 상한(글자). 넘으면 뒤를 자른다 (작성자 판단, 긴 정책 문서가 약 4만 자) */
export const maxPolicyChars = 60_000;

export function extractPrompt(title: string, bodyText: string, knownScreens: readonly string[], appName = "대상"): string {
  return [
    `${appName} 앱의 정책 문서 「${title}」에서 앱 화면으로 확인할 수 있는 규칙을 뽑아 JSON 하나로만 답하세요.`,
    "",
    "규칙 종류:",
    '- "copy": 고객에게 보이는 안내 문구. expected에 문구를 정책에 적힌 그대로 넣는다.',
    '- "value": 금액·횟수·기간·비율처럼 화면에 보이는 값. expected에 화면에 보일 글자(예: "1,000원")를 넣는다.',
    '- "behavior": 상태에 따라 버튼·문구가 보이거나 숨는 것처럼 화면을 봐야 판단할 수 있는 것.',
    "",
    "지킬 것:",
    "- evidence에는 정책 본문의 문장이나 표 한 줄을 한 글자도 바꾸지 말고 그대로 복사한다. 요약·번역·띄어쓰기 수정 금지. 본문에 없는 규칙은 만들지 않는다.",
    "- 어드민에서 바꿀 수 있다고 적힌 값은 value로 뽑지 않는다.",
    "- screens는 아래 화면 목록에서만 고른다. 경로 한 마디를 *로 쓸 수 있다. 맞는 화면이 없으면 빈 배열.",
    "- visibleOnOpen은 그 화면을 열기만 해도 보이면 true, 토스트·모달·오류·특정 상태에서만 보이면 false.",
    '- 최상위 screens에는 이 정책이 다루는 화면을 넣는다.',
    "",
    '형식: {"screens": ["/path"], "rules": [{"kind": "copy", "section": "섹션 제목", "statement": "규칙 한 줄", "expected": "화면 글자", "evidence": "본문 그대로", "screens": ["/path"], "visibleOnOpen": true}]}',
    "",
    "화면 목록:",
    ...knownScreens.map((screen) => `- ${screen}`),
    "",
    "정책 본문:",
    bodyText.slice(0, maxPolicyChars),
  ].join("\n");
}

/** 어긋남 분류(설계 문서 「어긋남 보고」). 버그 후보만 실패·슬랙 대상이다 */
export type FindingClass = "pending-app" | "app-changed" | "policy-outdated" | "docs-mismatch" | "bug-candidate";

export const findingLabels: Record<FindingClass, string> = {
  "pending-app": "앱 반영 전",
  "app-changed": "문서 갱신 누락 또는 버그",
  "policy-outdated": "정책 문서가 뒤처짐",
  "docs-mismatch": "문서끼리 어긋남",
  "bug-candidate": "버그 후보",
};

const dayMs = 86_400_000;

/** 정책 쪽 규칙이 최근에 생겼으면 앱 반영 전, 화면이 지난번과 달라졌으면 문서 갱신 누락, 둘 다 아니면 버그 후보 */
export function classifyFinding(rule: Pick<PolicyRule, "since">, screenChanged: boolean, now: number): FindingClass {
  const since = Date.parse(rule.since);
  if (Number.isFinite(since) && now - since < recentPolicyDays * dayMs) return "pending-app";
  return screenChanged ? "app-changed" : "bug-candidate";
}

/**
 * 피그마도 아는 화면이면 셋을 같이 본다(정책·피그마·앱). 앱이 정책과 다를 때
 * - 피그마가 정책 편이면 앱 버그(정책이 최근에 바뀌었으면 앱 반영 전)
 * - 피그마가 정책 편이 아니면 앱·피그마는 그대로 가고 정책 문서만 다른 것
 * 피그마 쪽을 모르면(`null`) 둘만 보는 분류로 돌아간다.
 */
export function classifyWithFigma(rule: Pick<PolicyRule, "since">, figmaAgreesWithPolicy: boolean | null, screenChanged: boolean, now: number): FindingClass {
  if (figmaAgreesWithPolicy === null) return classifyFinding(rule, screenChanged, now);
  if (!figmaAgreesWithPolicy) return "policy-outdated";
  return classifyFinding(rule, false, now);
}

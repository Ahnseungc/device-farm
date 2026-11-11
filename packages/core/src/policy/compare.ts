/**
 * 화면 하나를 정책 규칙·피그마 문구와 맞춰 본다(docs/design-policy-figma.md). LLM 없이 글자로 되는 것만 한다.
 * 화면 동작(behavior) 규칙은 판정(`judge.ts`)으로 넘긴다.
 */

import type { QaCheck } from "../qa/rules";
import { classifyWithFigma, findingLabels, screenMatches, shortHash, squash, type FindingClass, type PolicyRule } from "./rules";

/** 무시 한 줄(`policy/ignored.json`). 그때의 정책 본문 해시(피그마는 노드 문구 해시)에 묶인다 */
export interface PolicyIgnore {
  key: string;
  hash: string;
  reason: string;
  at: string;
}

export const isIgnored = (ignores: readonly PolicyIgnore[], key: string, hash: string) => ignores.some((item) => item.key === key && item.hash === hash);

export interface PolicyCheck extends QaCheck {
  /** 어긋났을 때 분류. 통과·판단 불가는 없다 */
  finding?: FindingClass;
  /** 무시할 때 쓰는 키와 해시 */
  ignoreKey: string;
  ignoreHash: string;
  ignored?: boolean;
  pageId?: string;
}

export const rulesForScreen = (rules: readonly PolicyRule[], path: string) => rules.filter((rule) => rule.screens.some((pattern) => screenMatches(pattern, path)));

/** 금액·날짜·횟수처럼 계정마다 다른 글자를 지운 화면 글자의 해시. 앱 화면이 바뀌었는지 보는 데 쓴다 */
export const screenTextHash = (text: string) => shortHash(squash(text).replace(/\d[\d,.:]*/g, "#"));

export interface CompareContext {
  path: string;
  /** document.body.innerText */
  text: string;
  ignores: readonly PolicyIgnore[];
  /** 지난번 이 화면 글자 해시와 다른가 */
  screenChanged: boolean;
  now: number;
  /** 이 화면의 피그마 문구. 연결된 노드가 없으면 null */
  figmaTexts?: readonly string[] | null;
}

const inFigma = (figmaTexts: readonly string[] | null | undefined, expected: string) =>
  figmaTexts && figmaTexts.length > 0 ? figmaTexts.map(squash).join("\u0000").includes(squash(expected)) : null;

const failed = (rule: PolicyRule, message: string, context: CompareContext): PolicyCheck => {
  const figma = inFigma(context.figmaTexts, rule.expected ?? "");
  const finding = classifyWithFigma(rule, figma, context.screenChanged, context.now);
  const side = figma === null ? "" : figma ? " 피그마에는 있습니다." : " 피그마에도 없습니다.";
  message = `${message}${side}`;
  const ignored = isIgnored(context.ignores, rule.id, rule.pageHash);
  return { id: rule.id, title: rule.statement, ok: false, message: `[${findingLabels[finding]}] ${message} · 「${rule.pageTitle}」`, finding, ignoreKey: rule.id, ignoreHash: rule.pageHash, ignored, pageId: rule.pageId };
};

/** 열자마자 보이는 문구·값 규칙: 기대 글자가 화면에 그대로 있는가(공백 무시) */
export function compareCopyRules(rules: readonly PolicyRule[], context: CompareContext): PolicyCheck[] {
  const screenText = squash(context.text);
  return rulesForScreen(rules, context.path)
    .filter((rule) => rule.kind !== "behavior" && rule.visibleOnOpen && rule.expected)
    .map((rule) =>
      screenText.includes(squash(rule.expected ?? ""))
        ? { id: rule.id, title: rule.statement, ok: true, ignoreKey: rule.id, ignoreHash: rule.pageHash, pageId: rule.pageId }
        : failed(rule, `화면에 「${rule.expected}」가 없습니다.`, context),
    );
}

/** 상황을 만들어야 보이는 규칙(토스트·모달 등). 점검하지 않고 개수만 알린다 */
export const situationalRules = (rules: readonly PolicyRule[], path: string) => rulesForScreen(rules, path).filter((rule) => rule.kind !== "behavior" && !rule.visibleOnOpen);

/** 피그마 문구 비교 결과 목록 하나에 보여 줄 최대 수 (작성자 판단) */
export const maxCopyDiff = 30;
/** 이보다 짧은 줄은 버튼 아이콘 글자·단위라 비교하지 않는다 (작성자 판단) */
const minCopyLength = 2;

/** 계정마다 다른 값(숫자·날짜)이 든 글자는 고정 문구가 아니다 */
const isStaticCopy = (text: string) => squash(text).length >= minCopyLength && !/\d/.test(text);

export interface CopyDiff {
  /** 피그마에 있는데 화면에 없는 문구 */
  missingOnScreen: string[];
  /** 화면에 있는데 피그마에 없는 문구 */
  notInFigma: string[];
}

export function diffFigmaCopy(figmaTexts: readonly string[], screenText: string): CopyDiff {
  const screen = squash(screenText);
  const figma = figmaTexts.map(squash).join("\u0000");
  const missingOnScreen = [...new Set(figmaTexts.map((text) => text.trim()).filter((text) => isStaticCopy(text) && !screen.includes(squash(text))))];
  const notInFigma = [...new Set(screenText.split("\n").map((line) => line.trim()).filter((line) => isStaticCopy(line) && !figma.includes(squash(line))))];
  return { missingOnScreen: missingOnScreen.slice(0, maxCopyDiff), notInFigma: notInFigma.slice(0, maxCopyDiff) };
}

/**
 * 피그마 문구 차이를 결과 줄로. 피그마 쪽 해시에 무시를 묶는다.
 * 「피그마에 있는데 화면에 없음」은 결과에 넣지 않는다. 한 화면에 연결된 노드가 퍼널의 다른 단계·오류 상태·공용 시트까지 담고 있어
 * 화면 하나에서 수백 줄이 나왔다. 「화면에 있는데 피그마에 없음」만 본다.
 */
export function figmaChecks(diff: CopyDiff, figmaHash: string, path: string, ignores: readonly PolicyIgnore[]): PolicyCheck[] {
  const toCheck = (text: string, side: "missing" | "extra"): PolicyCheck => {
    const key = `figma:${path}:${side}:${squash(text)}`;
    const message = side === "missing" ? "피그마에 있는데 화면에 없습니다." : "화면에 있는데 피그마에 없습니다.";
    return { id: key, title: `피그마 문구 「${text}」`, ok: false, message: `[피그마 차이] ${message}`, ignoreKey: key, ignoreHash: figmaHash, ignored: isIgnored(ignores, key, figmaHash) };
  };
  return diff.notInFigma.map((text) => toCheck(text, "extra"));
}

/** 정책 문구가 앱 화면엔 있는데 피그마에 없으면 피그마 쪽이 뒤처진 것(문서끼리 어긋남). 화면에 없는 것은 문구 규칙 쪽에서 셋을 같이 본다 */
export function docsMismatchChecks(rules: readonly PolicyRule[], figmaTexts: readonly string[], screenText: string, ignores: readonly PolicyIgnore[]): PolicyCheck[] {
  if (figmaTexts.length === 0) return [];
  const figma = figmaTexts.map(squash).join("\u0000");
  const screen = squash(screenText);
  return rules
    .filter((rule) => rule.kind === "copy" && rule.expected && screen.includes(squash(rule.expected)) && !figma.includes(squash(rule.expected)))
    .map((rule) => {
      const key = `docs:${rule.id}`;
      return { id: key, title: rule.statement, ok: false, message: `[${findingLabels["docs-mismatch"]}] 정책·앱 문구 「${rule.expected}」가 피그마에 없습니다. · 「${rule.pageTitle}」`, finding: "docs-mismatch" as const, ignoreKey: key, ignoreHash: rule.pageHash, ignored: isIgnored(ignores, key, rule.pageHash), pageId: rule.pageId };
    });
}

/** 무시하지 않은 버그 후보가 있으면 화면 실패. 나머지 어긋남은 실패가 아니다(설계 문서 「어긋남 보고」) */
export const hasBugCandidate = (checks: readonly PolicyCheck[]) => checks.some((check) => !check.ok && !check.ignored && check.finding === "bug-candidate");

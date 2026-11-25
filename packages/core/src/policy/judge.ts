/**
 * 글자로 안 되는 화면 동작 규칙을 Claude가 판정한다(설계 문서 「판정(LLM)」). 여기는 프롬프트·응답 해석·캐시 키만 둔다.
 * 판정은 맞음 / 다름(이유) / 판단 불가만 쓴다.
 * 글자 그대로는 화면에 없던 문구·값 규칙도 같이 보낸다. 같은 뜻의 문구가 화면에 있으면 「같은 뜻, 다른 문구」로 통과시킨다
 *.
 */

import { classifyWithFigma, findingLabels, parseJsonObject, shortHash, type PolicyRule } from "./rules";
import { isIgnored, type PolicyCheck, type PolicyIgnore } from "./compare";

export type VerdictResult = "match" | "differ" | "unknown";

/** 피그마가 정책·앱 중 어느 쪽과 같은가. 피그마 문구가 없거나 모르면 unknown */
export type FigmaSide = "policy" | "app" | "neither" | "unknown";

export interface Verdict {
  ruleId: string;
  result: VerdictResult;
  reason: string;
  figma?: FigmaSide;
}

/** 화면·정책·피그마 해시 조합. 셋 중 하나가 바뀔 때만 다시 묻는다 */
export const judgeKey = (path: string, screenHash: string, rules: readonly PolicyRule[], figmaHash: string) =>
  `${path}|${screenHash}|${shortHash(rules.map((rule) => `${rule.id}:${rule.pageHash}`).sort().join(","))}|${figmaHash}`;

/** 개인정보 화면(계좌·본인인증)은 스크린샷을 보내지 않는다 (설계 문서 「안전」) */
export const isSensitivePath = (path: string) => /(account|bank|certif|identity|verify|auth|kyc|password|pin)/i.test(path);

/** 판정에 보내는 화면 글자 상한 (작성자 판단) */
const maxScreenChars = 6_000;

/** 판정에 보내는 피그마 문구 상한 (작성자 판단) */
const maxFigmaChars = 6_000;

/** 판정에 보낼 규칙 한 줄. 문구·값 규칙은 정책 글자와 같은 뜻의 문구가 화면에 있는지 묻는다 */
const ruleLine = (rule: PolicyRule) =>
  rule.kind === "behavior" ? `- ${rule.id}: ${rule.statement} (근거: ${rule.evidence})` : `- ${rule.id}: [문구] 「${rule.expected ?? rule.statement}」와 같은 뜻의 문구가 화면에 있다 (근거: ${rule.evidence})`;

export function judgePrompt(path: string, text: string, rules: readonly PolicyRule[], screenshotFile: string | null, figmaTexts: readonly string[] = [], appName = "대상"): string {
  const hasCopy = rules.some((rule) => rule.kind !== "behavior");
  return [
    `${appName} 앱 화면 ${path}이 아래 정책 규칙에 맞는지 판정해 JSON 하나로만 답하세요.`,
    screenshotFile ? `화면 스크린샷: ${screenshotFile} (Read 도구로 열어 보세요)` : "스크린샷은 없습니다(개인정보 화면). 화면 글자로만 판정하세요.",
    "",
    "판정 기준:",
    '- "match": 화면이 규칙대로다.',
    '- "differ": 화면이 규칙과 다르다. reason에 화면에서 본 것을 적는다.',
    '- "unknown": 지금 화면 상태로는 알 수 없다(그 상태가 아님, 데이터 없음 등). 애매하면 unknown.',
    ...(hasCopy
      ? [
          "",
          "[문구] 규칙은 정책 글자가 화면에 그대로는 없던 것이다. 표현이 달라도 같은 뜻이면 match, reason에 그 화면 문구를 그대로 인용한다.",
          "숫자·단위·기간·횟수·대상·조건이 하나라도 다르거나 그런 문구가 없으면 differ. 열지 않은 시트·접힌 영역이라 안 보이면 unknown.",
        ]
      : []),
    "",
    "differ이면 아래 피그마 디자인 문구를 보고 figma에 피그마가 어느 쪽과 같은지 적는다:",
    '- "policy": 피그마가 정책대로다(앱만 다르다). "app": 피그마가 앱 화면과 같다(정책만 다르다). "neither": 셋 다 다르다. "unknown": 피그마로 알 수 없다.',
    "",
    'reason은 한국어 한 줄로 쓴다. 형식: {"verdicts": [{"ruleId": "...", "result": "differ", "reason": "한 줄", "figma": "app"}]}',
    "",
    "규칙:",
    ...rules.map(ruleLine),
    "",
    "화면 글자:",
    text.slice(0, maxScreenChars),
    "",
    "피그마 디자인 문구(이 화면에 연결된 노드들, 여러 상태가 섞여 있다):",
    figmaTexts.length > 0 ? figmaTexts.join("\n").slice(0, maxFigmaChars) : "(없음)",
  ].join("\n");
}

const results: readonly VerdictResult[] = ["match", "differ", "unknown"];
const sides: readonly FigmaSide[] = ["policy", "app", "neither", "unknown"];

export function parseVerdicts(text: string, rules: readonly PolicyRule[]): Verdict[] {
  const parsed = parseJsonObject(text);
  const ids = new Set(rules.map((rule) => rule.id));
  const list = Array.isArray(parsed.verdicts) ? parsed.verdicts : [];
  return list.flatMap((item): Verdict[] => {
    const value = item as Record<string, unknown>;
    if (typeof value.ruleId !== "string" || !ids.has(value.ruleId) || !results.includes(value.result as VerdictResult)) return [];
    const figma = sides.includes(value.figma as FigmaSide) ? (value.figma as FigmaSide) : "unknown";
    return [{ ruleId: value.ruleId, result: value.result as VerdictResult, reason: typeof value.reason === "string" ? value.reason : "", figma }];
  });
}

/** 판정을 결과 줄로. 판단 불가는 통과로 두고 사유만 남긴다 */
export function verdictChecks(
  rules: readonly PolicyRule[],
  verdicts: readonly Verdict[],
  context: { ignores: readonly PolicyIgnore[]; screenChanged: boolean; now: number },
): PolicyCheck[] {
  const byId = new Map(verdicts.map((verdict) => [verdict.ruleId, verdict]));
  return rules.map((rule) => {
    const verdict = byId.get(rule.id);
    const base = { id: rule.id, title: rule.statement, ignoreKey: rule.id, ignoreHash: rule.pageHash, pageId: rule.pageId };
    if (!verdict || verdict.result === "unknown") return { ...base, ok: true, message: `판단 불가${verdict?.reason ? `: ${verdict.reason}` : ""}` };
    if (verdict.result === "match") return { ...base, ok: true };
    const figmaAgrees = verdict.figma === "policy" ? true : verdict.figma === "app" ? false : null;
    const finding = classifyWithFigma(rule, figmaAgrees, context.screenChanged, context.now);
    return { ...base, ok: false, finding, ignored: isIgnored(context.ignores, rule.id, rule.pageHash), message: `[${findingLabels[finding]}] ${verdict.reason} · 「${rule.pageTitle}」` };
  });
}

/** 「같은 뜻, 다른 문구」 결과 앞머리 */
export const sameMeaningLabel = "같은 뜻, 다른 문구";

/**
 * 글자 비교에서 어긋난 문구·값 규칙을 판정으로 다시 본다. 같은 뜻(match)이면 통과로 바꾸고 화면 문구를 남긴다.
 * 다름·판단 불가·판정 없음은 글자 비교 결과를 그대로 둔다(피그마 편 분류도 글자로 한 것을 쓴다).
 */
export function meaningChecks(literal: readonly PolicyCheck[], verdicts: readonly Verdict[]): PolicyCheck[] {
  const same = new Map(verdicts.filter((verdict) => verdict.result === "match").map((verdict) => [verdict.ruleId, verdict.reason]));
  return literal.map((check) => {
    if (check.ok || !same.has(check.id)) return check;
    const reason = same.get(check.id);
    return { id: check.id, title: check.title, ok: true, message: `${sameMeaningLabel}${reason ? `: ${reason}` : ""}`, ignoreKey: check.ignoreKey, ignoreHash: check.ignoreHash, pageId: check.pageId };
  });
}

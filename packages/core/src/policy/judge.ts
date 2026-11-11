/**
 * 글자로 안 되는 화면 동작 규칙을 Claude가 판정한다(설계 문서 「판정(LLM)」). 여기는 프롬프트·응답 해석·캐시 키만 둔다.
 * 판정은 맞음 / 다름(이유) / 판단 불가만 쓴다.
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

export function judgePrompt(path: string, text: string, rules: readonly PolicyRule[], screenshotFile: string | null, figmaTexts: readonly string[] = [], appName = "대상"): string {
  return [
    `${appName} 앱 화면 ${path}이 아래 정책 규칙에 맞는지 판정해 JSON 하나로만 답하세요.`,
    screenshotFile ? `화면 스크린샷: ${screenshotFile} (Read 도구로 열어 보세요)` : "스크린샷은 없습니다(개인정보 화면). 화면 글자로만 판정하세요.",
    "",
    "판정 기준:",
    '- "match": 화면이 규칙대로다.',
    '- "differ": 화면이 규칙과 다르다. reason에 화면에서 본 것을 적는다.',
    '- "unknown": 지금 화면 상태로는 알 수 없다(그 상태가 아님, 데이터 없음 등). 애매하면 unknown.',
    "",
    "differ이면 아래 피그마 디자인 문구를 보고 figma에 피그마가 어느 쪽과 같은지 적는다:",
    '- "policy": 피그마가 정책대로다(앱만 다르다). "app": 피그마가 앱 화면과 같다(정책만 다르다). "neither": 셋 다 다르다. "unknown": 피그마로 알 수 없다.',
    "",
    'reason은 한국어 한 줄로 쓴다. 형식: {"verdicts": [{"ruleId": "...", "result": "differ", "reason": "한 줄", "figma": "app"}]}',
    "",
    "규칙:",
    ...rules.map((rule) => `- ${rule.id}: ${rule.statement} (근거: ${rule.evidence})`),
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

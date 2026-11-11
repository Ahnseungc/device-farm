/**
 * 화면 데이터 QA: 화면이 부르는 GET API 응답과 화면 글자로 "값이 맞게 조회·표시됐는가"를 본다.
 * 사람 QA가 하던 확인(합계가 맞는지, 받은 값이 화면에 그대로 보이는지)을 규칙으로 적는다. 판정에 LLM을 쓰지 않는다.
 * 화면·규칙 목록은 앱 설정(`AppConfig.qa.screens`)에서 받는다. 여기는 틀과 도우미만 둔다.
 * 브라우저에서도 읽을 수 있게 node 모듈을 쓰지 않는다.
 */

/** 화면 하나가 조회하는 API. `{userId}`는 로그인 세션의 사용자 id로 바꾼다. */
export type ScreenApis = Record<string, string>;

export interface QaContext {
  /** API 이름 → 파싱한 응답 본문 */
  responses: Record<string, unknown>;
  /** 화면에 보이는 글자(document.body.innerText) */
  text: string;
}

export interface QaCheck {
  id: string;
  title: string;
  ok: boolean;
  message?: string;
}

export interface QaRule {
  id: string;
  title: string;
  /** 통과면 null, 아니면 사람이 읽을 사유 */
  check(context: QaContext): string | null;
}

export interface QaScreen {
  path: string;
  name: string;
  apis: ScreenApis;
  rules: QaRule[];
}

/** 원 단위 금액 표기: 989946088 → "989,946,088" */
export function formatWon(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

/** 화면 글자에서 공백·줄바꿈을 지워 "989,946,088\n원"도 "989,946,088원"으로 찾는다. */
const squash = (text: string) => text.replace(/\s+/g, "");

export function textHas(text: string, expected: string): boolean {
  return squash(text).includes(squash(expected));
}

/** 응답에서 점 경로로 값을 꺼낸다. 없으면 undefined. */
export function pick(source: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, key) => (current && typeof current === "object" ? (current as Record<string, unknown>)[key] : undefined), source);
}

/** 규칙 하나를 돌린다. 응답 모양이 달라 계산이 안 되면 그것도 실패 사유로 남긴다. */
export function runRule(rule: QaRule, context: QaContext): QaCheck {
  try {
    const message = rule.check(context);
    return message === null ? { id: rule.id, title: rule.title, ok: true } : { id: rule.id, title: rule.title, ok: false, message };
  } catch (error) {
    return { id: rule.id, title: rule.title, ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

/** 금액 비교 규칙에서 쓰는 사유 문장. 같으면 null */
export const equalWon = (label: string, actual: number, expected: number) =>
  actual === expected ? null : `${label}: ${formatWon(actual)}원인데 ${formatWon(expected)}원이어야 합니다.`;

/** 응답 점 경로의 숫자. 숫자가 아니면 throw해 규칙 실패 사유가 된다 */
export function numberAt(context: QaContext, api: string, path: string): number {
  const value = pick(context.responses[api], path);
  if (typeof value !== "number") throw new Error(`${api}.${path} 값이 숫자가 아닙니다.`);
  return value;
}

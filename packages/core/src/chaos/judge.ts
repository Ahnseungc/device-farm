import type { Issue, IssueKind } from "../explore/probe";

/** 오류로 치는 판정. 레이아웃(overflow·offscreen·bottom-covered)은 정확도가 낮아 경고로만 남긴다(설계 문서 판정). */
const errorKinds: readonly IssueKind[] = ["app-error", "crash", "console", "network", "blank", "login-redirect", "stuck"];
/** 가드가 요청을 끊으면(route.abort) WebView 콘솔에 이 문구가 남는다 */
const guardAbortText = "ERR_BLOCKED_BY_CLIENT";
/** 재시작·백그라운드 직후 빈 화면은 로딩으로 본다 (설계 문서 오탐 줄이기) */
export const relaunchGraceMs = 5_000;

export interface JudgeContext {
  /** 마지막 재시작·백그라운드 복귀 뒤 지난 시간 */
  sinceRelaunchMs: number;
  /** 이 스텝에서 가드가 쓰기 요청을 막았다 */
  guardBlocked: boolean;
}

export interface Judgement {
  errors: Issue[];
  /** 레이아웃 경고와, 가드·재시작 때문에 난 것으로 보고 내린 판정 */
  warnings: Issue[];
}

/**
 * 가드가 막은 요청 때문에 생긴 콘솔·네트워크 오류는 앱 문제가 아니다.
 * 첫 실행에서 오류 대부분이 가드 차단(ERR_BLOCKED_BY_CLIENT, 푸시 토큰 저장 POST 차단)이었다.
 */
function causedByChaos(issue: Issue, context: JudgeContext): boolean {
  if (issue.kind === "console" && issue.message.includes(guardAbortText)) return true;
  if (context.guardBlocked && (issue.kind === "console" || issue.kind === "network")) return true;
  return issue.kind === "blank" && context.sinceRelaunchMs < relaunchGraceMs;
}

export function judgeIssues(issues: readonly Issue[], context: JudgeContext): Judgement {
  const errors = issues.filter((issue) => errorKinds.includes(issue.kind) && !causedByChaos(issue, context));
  return { errors, warnings: issues.filter((issue) => !errors.includes(issue)) };
}

/** 같은 오류인지 가르는 키: 판정 종류 + 메시지 앞부분(주소의 숫자는 지운다) (설계 문서: 실행 안에서 한 번만 센다) */
const dedupeMessageLength = 80;

export function errorKey(issue: Issue): string {
  return `${issue.kind}|${issue.message.replace(/\d+/g, "N").slice(0, dedupeMessageLength)}`;
}

/** 실행에서 이미 센 오류는 경고로 내린다. seen은 실행 내내 이어진다. */
export function dedupeErrors(judgement: Judgement, seen: Set<string>): Judgement {
  const fresh: Issue[] = [];
  const repeated: Issue[] = [];
  for (const issue of judgement.errors) {
    const key = errorKey(issue);
    if (seen.has(key)) {
      repeated.push(issue);
      continue;
    }
    seen.add(key);
    fresh.push(issue);
  }
  return { errors: fresh, warnings: [...judgement.warnings, ...repeated] };
}

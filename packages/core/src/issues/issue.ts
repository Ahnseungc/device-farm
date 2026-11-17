/**
 * 「문제」 화면의 한 줄. 슬랙에 보낸(또는 요약으로 묶은) 알림 기록을 사람이 읽는 꼴로 바꾼다.
 * 알림 기록이 곧 문제 목록이다 — 상태(확인 필요·확인 중·처리 완료·문제 아님)는 슬랙 버튼과 디바이스팜이 같은 기록을 고친다.
 */

import { findingLabels, type FindingClass } from "../policy/rules";
import type { DesignAlert } from "../slack/design-alert";
import type { FailureAlert } from "../slack/failure-alert";
import type { AlertStatus, AlertStatusInfo, PolicyAlert } from "../slack/policy-alert";

export const issueKinds = ["app-error", "behavior", "policy", "design", "docs", "unverified"] as const;
export type IssueKind = (typeof issueKinds)[number];

export const issueKindLabels: Record<IssueKind, string> = {
  "app-error": "앱 오류",
  behavior: "동작 오류",
  policy: "정책 위반",
  design: "디자인 오류",
  docs: "문서 갱신",
  unverified: "확인 필요",
};

/** 누가 봐야 하는지 한 줄 */
export const issueKindHints: Record<IssueKind, string> = {
  "app-error": "화면이 안 열리거나 오류가 났어요",
  behavior: "누르거나 이동하는 흐름이 막혔어요",
  policy: "정책·피그마와 앱 화면이 달라요",
  design: "피그마 시안과 화면이 달라요",
  docs: "앱은 맞는데 정책서나 피그마가 뒤처졌어요",
  unverified: "자동으로 판단하지 못했어요. 화면을 직접 봐 주세요",
};

export interface IssueLink {
  label: string;
  url: string;
}

export interface FarmIssue {
  key: string;
  kind: IssueKind;
  /** 세부 분류(정책: 버그 후보·앱 반영 전 등) */
  label: string;
  title: string;
  detail: string;
  path: string;
  status: AlertStatus;
  by?: string;
  at?: string;
  sentAt: string;
  /** 슬랙에 하나로 보냈는가(요약으로만 묶였으면 false) */
  onSlack: boolean;
  runId: string;
  build: string;
  device: string;
  links: IssueLink[];
  /** 디자인 오류 묶음의 화면별 문구 */
  items?: { path: string; texts: string[] }[];
  /** 결과 폴더 기준 스크린샷(서버가 점검 기록에서 찾아 붙인다) */
  screenshot?: string;
}

/** 알림 기록 한 건(engine `SentAlert`와 같은 꼴) */
export interface StoredAlert extends AlertStatusInfo {
  alert: PolicyAlert | FailureAlert | DesignAlert;
  ts: string;
  sentAt: string;
}

const policyKindOf = (finding: FindingClass): IssueKind => {
  if (finding === "unverified") return "unverified";
  if (finding === "policy-outdated" || finding === "docs-mismatch") return "docs";
  return "policy";
};

const base = (key: string, stored: StoredAlert) => ({
  key,
  status: stored.status,
  ...(stored.by ? { by: stored.by } : {}),
  ...(stored.at ? { at: stored.at } : {}),
  sentAt: stored.sentAt,
  onSlack: stored.ts !== "",
});

export function issueOf(key: string, stored: StoredAlert): FarmIssue {
  const { alert } = stored;
  if ("type" in alert && alert.type === "design") {
    const count = alert.diffs.length;
    return {
      ...base(key, stored),
      kind: "design",
      label: "피그마와 다른 문구",
      title: `피그마와 다른 문구 ${count}개 · ${alert.path}`,
      detail: alert.screens.map((screen) => `${screen.path}: ${screen.texts.slice(0, 3).map((text) => `「${text}」`).join(" ")}`).join("\n"),
      path: alert.path,
      runId: alert.runId,
      build: alert.build,
      device: alert.device,
      links: [...new Set(alert.screens.flatMap((screen) => screen.figmaUrls))].slice(0, 3).map((url, index) => ({ label: `피그마 ${index + 1}`, url })),
      items: alert.screens.map((screen) => ({ path: screen.path, texts: screen.texts })),
    };
  }
  if ("type" in alert && alert.type === "failure") {
    return {
      ...base(key, stored),
      kind: alert.finding,
      label: issueKindLabels[alert.finding],
      title: alert.path,
      detail: alert.message,
      path: alert.path,
      runId: alert.runId,
      build: alert.build,
      device: alert.device,
      links: [],
    };
  }
  const policy = alert as PolicyAlert;
  return {
    ...base(key, stored),
    kind: policyKindOf(policy.finding),
    label: findingLabels[policy.finding],
    title: policy.title,
    detail: policy.message,
    path: policy.path,
    runId: policy.runId,
    build: policy.build,
    device: policy.device,
    links: [...(policy.policy ? [{ label: `정책서 · ${policy.policy.title}`, url: policy.policy.url }] : []), ...policy.figmaUrls.map((url, index) => ({ label: `피그마 ${index + 1}`, url }))],
  };
}

const statusOrder: Record<AlertStatus, number> = { open: 0, checking: 1, done: 2, "not-issue": 3 };

/** 열린 것 먼저, 그 안에서 최근 것 먼저 */
export function sortIssues(issues: readonly FarmIssue[]): FarmIssue[] {
  return [...issues].sort((a, b) => statusOrder[a.status] - statusOrder[b.status] || b.sentAt.localeCompare(a.sentAt));
}

/** 「문제」 화면 숫자: 유형별 열린 수 */
export function openCounts(issues: readonly FarmIssue[]): Record<IssueKind, number> {
  const counts = Object.fromEntries(issueKinds.map((kind) => [kind, 0])) as Record<IssueKind, number>;
  for (const issue of issues) if (issue.status === "open" || issue.status === "checking") counts[issue.kind] += 1;
  return counts;
}

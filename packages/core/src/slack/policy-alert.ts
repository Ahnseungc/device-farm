/**
 * 정책·피그마·앱 구현이 서로 다를 때 보내는 슬랙 알림(「정책 불일치」).
 * 점검 결과에서 알릴 것을 고르고 Block Kit 메시지를 만든다. 보내기·버튼 처리는 engine·server가 한다.
 */

import type { DeviceRun } from "../device/types";
import type { PolicyCheck } from "../policy/compare";
import { findingLabels, type FindingClass } from "../policy/rules";

import type { FixPrInfo } from "./fix-pr";

/** 처리 상태. 슬랙 버튼으로 바꾼다 */
export type AlertStatus = "open" | "checking" | "done" | "not-issue";

export const alertStatusLabels: Record<AlertStatus, string> = {
  open: "확인 필요",
  checking: "확인 중",
  done: "처리 완료",
  "not-issue": "문제 아님",
};

const alertStatusEmoji: Record<AlertStatus, string> = {
  open: ":large_purple_circle:",
  checking: ":hourglass_flowing_sand:",
  done: ":white_check_mark:",
  "not-issue": ":heavy_minus_sign:",
};

/** 정책·피그마·앱 셋이 어긋난 분류. 앱 반영 전도 알린다(정책을 바꾼 사람이 앱 반영을 챙기게) */
const alertFindings: readonly FindingClass[] = ["bug-candidate", "policy-outdated", "docs-mismatch", "unverified", "pending-app", "app-changed"];

/** 점검 중 바로 보내는 분류(앱을 고쳐야 할 수 있는 것). 나머지는 점검이 끝날 때 요약으로 */
export const urgentFindings: readonly FindingClass[] = ["bug-candidate", "app-changed"];

/** 분류마다 누가 볼지 한 줄 */
const findingHints: Record<FindingClass, string> = {
  "bug-candidate": "정책·피그마는 같은데 앱만 달라요 → 앱 수정이 필요해요",
  "policy-outdated": "앱·피그마는 같은데 정책만 달라요 → 정책 문서 갱신이 필요해요",
  "docs-mismatch": "정책·앱은 같은데 피그마만 달라요 → 피그마 갱신이 필요해요",
  unverified: "피그마 연결이 없어 정책과만 비교했어요 → 화면과 정책 중 맞는 쪽을 확인해 주세요",
  "pending-app": "정책이 최근(14일 안) 바뀌었어요 → 앱 반영 일정을 확인해 주세요",
  "app-changed": "앱 화면이 바뀌었는데 문서는 그대로예요 → 문서 갱신 또는 버그인지 확인해 주세요",
};

export interface PolicyPageLink {
  title: string;
  url: string;
  /** 정책서 작성자 이름(Confluence). 슬랙 계정을 찾으면 태그한다 */
  ownerName?: string;
  ownerSlackId?: string;
}

export interface PolicyAlert {
  /** 같은 어긋남이면 같은 키. 한 번만 보낸다 */
  key: string;
  ignoreKey: string;
  ignoreHash: string;
  finding: FindingClass;
  path: string;
  title: string;
  message: string;
  policy: PolicyPageLink | null;
  figmaUrls: string[];
  device: string;
  build: string;
  runId: string;
}

/** `fileKey:12:34` → 피그마 노드 링크 */
export function figmaUrl(ref: string): string {
  const [fileKey, ...node] = ref.split(":");
  return `https://www.figma.com/design/${fileKey}/?node-id=${node.join("-")}`;
}

const policyPrefixes = ["정책 점검 · ", "정책 · "] as const;
const policyPathOf = (scenario: string) => {
  const prefix = policyPrefixes.find((item) => scenario.startsWith(item));
  return prefix ? scenario.slice(prefix.length) : null;
};

/** 메시지에 넣는 피그마 링크 수 (작성자 판단) */
export const maxFigmaLinks = 3;

export interface AlertContext {
  policyPage: (pageId: string) => PolicyPageLink | null;
  /** 화면 경로 → 연결된 피그마 노드(`fileKey:nodeId`) */
  figmaRefs: (path: string) => string[];
}

/** 끝난 점검에서 알릴 어긋남. 무시한 것과 분류 없는 피그마 문구 차이는 뺀다 */
export function policyAlertsOf(run: DeviceRun, context: AlertContext): PolicyAlert[] {
  return run.outcomes.flatMap((outcome) =>
    outcome.screens.flatMap((screen) => {
      const path = policyPathOf(screen.scenario);
      if (!path) return [];
      return ((screen.checks ?? []) as PolicyCheck[])
        .filter((check) => !check.ok && !check.ignored && check.finding && alertFindings.includes(check.finding))
        .map((check): PolicyAlert => ({
          key: `${path}|${check.ignoreKey}|${check.ignoreHash}`,
          ignoreKey: check.ignoreKey,
          ignoreHash: check.ignoreHash,
          finding: check.finding as FindingClass,
          path,
          title: check.title,
          message: (check.message ?? "").replace(/^\[[^\]]+\]\s*/, ""),
          policy: check.pageId ? context.policyPage(check.pageId) : null,
          figmaUrls: context.figmaRefs(path).slice(0, maxFigmaLinks).map(figmaUrl),
          device: `${outcome.device.model} (${outcome.device.platform} ${outcome.device.osVersion})`,
          build: `${run.kind} ${run.version}`,
          runId: run.runId,
        }));
    }),
  );
}

export interface AlertStatusInfo {
  status: AlertStatus;
  /** 슬랙 사용자 id */
  by?: string;
  at?: string;
  /** 「수정 PR 만들기」 버튼 진행 (packages/engine/src/fix-pr/specs/README.md) */
  fix?: FixPrInfo;
}

/** 버튼 action_id. value에 알림 키를 담는다 */
export const alertActionIds: Record<Exclude<AlertStatus, "open">, string> = {
  checking: "policy_alert_checking",
  done: "policy_alert_done",
  "not-issue": "policy_alert_not_issue",
};

export function statusOfAction(actionId: string): Exclude<AlertStatus, "open"> | null {
  const found = (Object.entries(alertActionIds) as [Exclude<AlertStatus, "open">, string][]).find(([, id]) => id === actionId);
  return found ? found[0] : null;
}

/** 정책서 작성자: 슬랙 계정을 찾았으면 태그, 아니면 이름만 */
const ownerMention = (policy: PolicyPageLink | null) => (policy?.ownerSlackId ? `<@${policy.ownerSlackId}>` : (policy?.ownerName ?? "알 수 없음"));

const linkLine = (alert: PolicyAlert) => {
  const policy = alert.policy ? `<${alert.policy.url}|정책서: ${alert.policy.title}>` : "정책서 링크 없음";
  const figma = alert.figmaUrls.length > 0 ? alert.figmaUrls.map((url, index) => `<${url}|피그마 ${index + 1}>`).join(" · ") : "연결된 피그마 없음";
  return `${policy}\n${figma}`;
};

/** 알림 메시지(Block Kit). 상태가 바뀌면 같은 모양으로 다시 만들어 메시지를 고친다. 버튼은 「확인 필요」일 때만 둔다 */
/** 상태 줄: 이모지 · 상태 · 누른 사람 · 시각 */
export const statusText = (status: AlertStatusInfo) =>
  `${alertStatusEmoji[status.status]} *${alertStatusLabels[status.status]}*${status.by ? ` · <@${status.by}>` : ""}${status.at ? ` · ${status.at}` : ""}`;

export function policyAlertBlocks(alert: PolicyAlert, status: AlertStatusInfo = { status: "open" }): unknown[] {
  return [
    { type: "section", text: { type: "mrkdwn", text: `:large_purple_circle: *정책·피그마·앱 불일치 · ${findingLabels[alert.finding]}*\n${findingHints[alert.finding]}\n정책서 작성자 ${ownerMention(alert.policy)} 확인 부탁드려요.` } },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*화면*\n\`${alert.path}\`` },
        { type: "mrkdwn", text: `*빌드·기기*\n${alert.build} · ${alert.device}` },
        { type: "mrkdwn", text: `*규칙*\n${alert.title}` },
        { type: "mrkdwn", text: `*다른 점*\n${alert.message || "-"}` },
      ],
    },
    { type: "section", text: { type: "mrkdwn", text: linkLine(alert) } },
    { type: "context", elements: [{ type: "mrkdwn", text: `상태: ${statusText(status)} · 점검 \`${alert.runId}\`` }] },
    ...(status.status === "open" ? [statusButtons(alert.key)] : []),
  ];
}

/** 처리 상태 버튼. 누가 한 번 고르면 메시지에서 사라진다. value에 알림 키를 담는다 */
export function statusButtons(key: string): unknown {
  return {
    type: "actions",
    block_id: "policy_alert_status",
    elements: [
      { type: "button", action_id: alertActionIds.done, style: "primary", text: { type: "plain_text", text: "처리 완료" }, value: key },
      { type: "button", action_id: alertActionIds.checking, text: { type: "plain_text", text: "확인 중" }, value: key },
      { type: "button", action_id: alertActionIds["not-issue"], text: { type: "plain_text", text: "문제 아님" }, value: key },
    ],
  };
}

/** 알림 미리보기·접근성용 한 줄(슬랙 알림 배너) */
export const policyAlertText = (alert: PolicyAlert) => `정책·피그마·앱 불일치 · ${findingLabels[alert.finding]} · ${alert.path} · ${alert.title}`;

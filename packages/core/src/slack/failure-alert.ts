/**
 * 점검 중 실패한 화면(플로우·데이터·화면 점검)을 슬랙에 바로 알린다(「점검 중 실패 알림」).
 * 정책 점검 불일치는 policy-alert.ts가 맡는다. 기준 화면 차이·로그인 필요는 보내지 않는다.
 */

import { errorCauseLabel } from "../device/button-check";
import type { DeviceOutcome, DeviceRun, DeviceScreen } from "../device/types";
import { alertActionBlocks, fixPrContext } from "./fix-pr";
import { plainError } from "./plain-error";
import { statusText, type AlertStatusInfo } from "./policy-alert";

/** 앱 오류: 오류 화면·안 그려짐·흰 화면·API·데이터 값. 동작 오류: 플로우 단계 실패·이동 실패. 디자인 오류: 화면 깨짐 점검(넘침·잘림·겹침) */
export type FailureType = "app-error" | "behavior" | "design";

export const failureTypeLabels: Record<FailureType, string> = {
  "app-error": ":red_circle: 앱 오류",
  behavior: ":large_orange_circle: 동작 오류",
  design: ":large_purple_circle: 디자인 오류",
};

export interface FailureAlert {
  type: "failure";
  key: string;
  /** 점검 이름(시나리오). 기록 표의 path 열 */
  path: string;
  /** 실패 유형. 기록 표의 finding 열 */
  finding: FailureType;
  message: string;
  device: string;
  build: string;
  runId: string;
}

const flowPrefixes = ["플로우 점검 · ", "플로우 · "];
const policyPrefixes = ["정책 점검 · ", "정책 · "];
/** 「배치 점검 · 」은 2026-11-16 이전 이름(예전 기록) */
const layoutPrefixes = ["화면 깨짐 점검 · ", "배치 점검 · "];
/** 새 빌드마다 많이 생겨 기준 화면 탭에서 확정하는 것 — 알리지 않는다 */
const baselineDiffText = "기준 화면과 다릅니다";

/** 이 화면 실패를 알릴지, 알린다면 어떤 유형인지 */
export function failureTypeOf(screen: DeviceScreen): FailureType | null {
  if (screen.status !== "failed") return null;
  if (policyPrefixes.some((prefix) => screen.scenario.startsWith(prefix))) return null;
  const message = screen.message ?? "";
  if (message.startsWith(baselineDiffText)) return null;
  if (layoutPrefixes.some((prefix) => screen.scenario.startsWith(prefix))) return "design";
  if (flowPrefixes.some((prefix) => screen.scenario.startsWith(prefix))) return "behavior";
  if (/이동 실패|가지 않았습니다|누르지 않았습니다/.test(message)) return "behavior";
  return "app-error";
}

/** 요청 줄(`GET 404 https://…`)의 상태 코드 바로 앞 */
const beforeHttpStatus = /\b(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|UNKNOWN) $/;

/** 숫자·시각은 지워 같은 실패를 같은 키로 본다. 요청 상태 코드는 남긴다 — 404를 넘겼다고 500까지 넘기면 안 된다 */
const stableMessage = (message: string) =>
  message.replace(/\d[\d,.:]*/g, (digits: string, offset: number) => (beforeHttpStatus.test(message.slice(0, offset)) ? digits : "#")).slice(0, 120);

/** 기준 학습 앞머리(`packages/engine/src/check.ts`). 학습이 끝나면 빠져 무시 키가 어긋났다 */
const baselineLearningNote = /기준 학습 중\([^)]*\): 바뀌는 곳을 비교에서 뺐습니다\.(?: · )?/g;

/**
 * 무시 키가 보는 실패 문구. 버튼 에러는 원인(`에러 원인: …`)만 본다 —
 * 버튼 이름에 알림 본문처럼 매일 바뀌는 글이 들어가 「문제 아님」이 다음 점검에 안 맞았다.
 */
function ignoreSubject(message: string): string {
  const cause = message.indexOf(errorCauseLabel);
  if (cause >= 0) return message.slice(cause);
  return message.replace(baselineLearningNote, "");
}

/** 실패 알림 「문제 아님」의 무시 목록 키·해시. 빌드 종류(dev·prod)와 상관없이 같은 화면·같은 실패면 넘긴다 */
export const failureIgnoreHash = "failure";
export const failureIgnoreKey = (scenario: string, message: string) => `failure|${scenario}|${stableMessage(ignoreSubject(message))}`;

/** 「문제 아님」으로 넘긴 실패의 사유 앞머리 */
export const notIssuePrefix = "문제 아님으로 넘김";

/**
 * 슬랙 실패 알림에서 「문제 아님」을 누른 실패(같은 화면·같은 실패 문구)는 통과로 바꾼다.
 * 기기 결과·끝 알림·실패 알림 모두 이걸 기준으로 센다. 바꾼 수를 돌려준다.
 */
export function skipIgnoredFailures(screens: DeviceScreen[], ignores: readonly { key: string; hash: string; reason: string }[]): number {
  const reasonOf = new Map(ignores.filter((item) => item.hash === failureIgnoreHash).map((item) => [item.key, item.reason]));
  let count = 0;
  for (const screen of screens) {
    if (screen.status !== "failed") continue;
    const reason = reasonOf.get(failureIgnoreKey(screen.scenario, screen.message ?? ""));
    if (!reason) continue;
    screen.status = "passed";
    screen.message = `${notIssuePrefix}(${reason}): ${screen.message ?? ""}`;
    count += 1;
  }
  return count;
}

export function failureAlertOf(run: DeviceRun, outcome: DeviceOutcome, screen: DeviceScreen): FailureAlert | null {
  const finding = failureTypeOf(screen);
  if (!finding) return null;
  const message = screen.message ?? "";
  return {
    type: "failure",
    key: `failure|${run.kind}|${screen.scenario}|${stableMessage(message)}`,
    path: screen.scenario,
    finding,
    message,
    device: `${outcome.device.model} (${outcome.device.platform} ${outcome.device.osVersion})`,
    build: `${run.kind} ${run.version}`,
    runId: run.runId,
  };
}

export const failureAlertText = (alert: FailureAlert) => `${failureTypeLabels[alert.finding].replace(/^:[a-z_]+: /, "")} · ${alert.path}`;

/** `fixPr`: 「수정 PR 만들기」 버튼을 단다(서버에 GitHub 토큰이 있을 때) */
export function failureAlertBlocks(alert: FailureAlert, status: AlertStatusInfo = { status: "open" }, fixPr = false): unknown[] {
  return [
    { type: "section", text: { type: "mrkdwn", text: `${failureTypeLabels[alert.finding]} *${alert.path}*` } },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*빌드·기기*\n${alert.build} · ${alert.device}` },
        { type: "mrkdwn", text: `*실패 내용*\n${plainError(alert.message) || "-"}` },
      ],
    },
    { type: "context", elements: [{ type: "mrkdwn", text: `상태: ${statusText(status)} · 점검 \`${alert.runId}\` · 실패 화면·영상·로그는 디바이스팜 결과 탭` }] },
    ...fixPrContext(status),
    ...alertActionBlocks(alert.key, status, fixPr),
  ];
}

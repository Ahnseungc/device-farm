/**
 * 점검 중 실패한 화면(플로우·데이터·화면 점검)을 슬랙에 바로 알린다(「점검 중 실패 알림」).
 * 정책 점검 불일치는 policy-alert.ts가 맡는다. 기준 화면 차이·로그인 필요는 보내지 않는다.
 */

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

/** 숫자·시각은 지워 같은 실패를 같은 키로 본다 */
const stableMessage = (message: string) => message.replace(/\d[\d,.:]*/g, "#").slice(0, 120);

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

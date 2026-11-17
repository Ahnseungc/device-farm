/**
 * 「피그마와 다른 문구」(화면에 있는데 피그마에 없음)를 점검마다 한 건으로 묶어 알린다(「디자인 오류」).
 * 2026-11-12 전체 점검 74건 중 진짜 디자인 차이는 10% 안팎이었다. 사용자·서버 데이터는 거르고, 전에 알린 차이는 다시 알리지 않는다.
 */

import type { DeviceRun } from "../device/types";
import type { PolicyCheck } from "../policy/compare";

import { alertActionBlocks, fixPrContext } from "./fix-pr";
import { statusText, type AlertStatusInfo } from "./policy-alert";

/** 피그마 차이 한 건 */
export interface DesignDiff {
  /** 같은 차이면 같은 키(화면·문구·피그마 해시) */
  key: string;
  path: string;
  text: string;
  ignoreKey: string;
  ignoreHash: string;
}

export interface DesignScreen {
  path: string;
  texts: string[];
  figmaUrls: string[];
}

export interface DesignAlert {
  type: "design";
  /** 점검 하나에 한 건 */
  key: string;
  /** 기록 표의 path·finding 열 */
  path: string;
  finding: "design-diff";
  diffs: DesignDiff[];
  screens: DesignScreen[];
  device: string;
  build: string;
  runId: string;
}

const policyPrefix = "정책 점검 · ";
const figmaCheckPrefix = "figma:";
/** 메시지에 넣는 화면·화면당 문구 수 (작성자 판단, 슬랙 섹션 한도 3000자 안) */
export const maxDesignScreens = 10;
export const maxTextsPerScreen = 5;

/**
 * 사용자·서버 데이터라 디자인과 비교할 수 없는 글자.
 * 가린 이름(「이*환님」), 「OO님」 같은 호칭, 해시태그·키워드 목록(SNS 리뷰), QA 계정 주인 이름(`names`).
 */
export function isUserDataText(text: string, names: readonly string[] = []): boolean {
  const value = text.trim();
  if (/[가-힣A-Za-z]\*+[가-힣A-Za-z]/.test(value)) return true;
  if (/^\S{1,4}님$/.test(value)) return true;
  if (/(^|\s|,)#\S/.test(value) || /키워드\s*:/.test(value)) return true;
  return names.some((name) => name.length > 0 && value.includes(name));
}

/** 피그마 문구 check(`피그마 문구 「…」`)에서 문구만 */
const textOf = (check: PolicyCheck) => /「([\s\S]*)」/.exec(check.title)?.[1] ?? check.title;

/** 점검의 정책 화면에서 거른 피그마 차이. 무시한 것은 뺀다 */
export function designDiffsOf(run: DeviceRun, names: readonly string[] = []): DesignDiff[] {
  return run.outcomes.flatMap((outcome) =>
    outcome.screens
      .filter((screen) => screen.scenario.startsWith(policyPrefix))
      .flatMap((screen) =>
        ((screen.checks ?? []) as PolicyCheck[])
          .filter((check) => check.id.startsWith(figmaCheckPrefix) && !check.ok && !check.ignored)
          .map((check) => ({ check, text: textOf(check) }))
          .filter(({ text }) => !isUserDataText(text, names))
          .map(({ check, text }) => ({
            key: `${check.ignoreKey}|${check.ignoreHash}`,
            path: screen.scenario.slice(policyPrefix.length),
            text,
            ignoreKey: check.ignoreKey,
            ignoreHash: check.ignoreHash,
          })),
      ),
  );
}

/** 새 차이를 화면별로 묶은 알림. 새 것이 없으면 null */
export function designAlertOf(run: DeviceRun, fresh: readonly DesignDiff[], figmaUrls: (path: string) => string[]): DesignAlert | null {
  if (fresh.length === 0) return null;
  const paths = [...new Set(fresh.map((diff) => diff.path))];
  const device = run.outcomes[0]?.device;
  return {
    type: "design",
    key: `design|${run.runId}`,
    path: paths.length === 1 ? paths[0] : `${paths[0]} 외 ${paths.length - 1}곳`,
    finding: "design-diff",
    diffs: [...fresh],
    screens: paths.map((path) => ({ path, texts: fresh.filter((diff) => diff.path === path).map((diff) => diff.text), figmaUrls: figmaUrls(path) })),
    device: device ? `${device.model} (${device.platform} ${device.osVersion})` : "-",
    build: `${run.kind} ${run.version}`,
    runId: run.runId,
  };
}

const oneLine = (text: string) => text.replace(/\s+/g, " ").slice(0, 80);

const screenLines = (screen: DesignScreen) => {
  const figma = screen.figmaUrls.length > 0 ? ` · ${screen.figmaUrls.slice(0, 2).map((url, index) => `<${url}|피그마${screen.figmaUrls.length > 1 ? ` ${index + 1}` : ""}>`).join(" ")}` : "";
  const texts = screen.texts.slice(0, maxTextsPerScreen).map((text) => `   • 「${oneLine(text)}」`);
  const more = screen.texts.length > maxTextsPerScreen ? [`   • …외 ${screen.texts.length - maxTextsPerScreen}개`] : [];
  return [`*\`${screen.path}\`*${figma}`, ...texts, ...more].join("\n");
};

export const designAlertText = (alert: DesignAlert) => `디자인 오류 · 피그마와 다른 문구 ${alert.diffs.length}건 · ${alert.path}`;

/** Block Kit. 「문제 아님」을 누르면 묶인 차이를 전부 무시 목록에 넣는다(서버) */
export function designAlertBlocks(alert: DesignAlert, status: AlertStatusInfo = { status: "open" }, fixPr = false): unknown[] {
  const shown = alert.screens.slice(0, maxDesignScreens);
  const hidden = alert.screens.length - shown.length;
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `:large_purple_circle: *디자인 오류 · 피그마와 다른 문구 ${alert.diffs.length}건*\n피그마에 없는 글자가 화면에 있어요 → 디자인과 다르게 구현됐거나 피그마 갱신이 필요해요. 처음 본 것만 모았어요.`,
      },
    },
    ...shown.map((screen) => ({ type: "section", text: { type: "mrkdwn", text: screenLines(screen) } })),
    ...(hidden > 0 ? [{ type: "context", elements: [{ type: "mrkdwn", text: `화면 ${hidden}곳 더 — 디바이스팜 정책 탭에서 볼 수 있어요` }] }] : []),
    { type: "context", elements: [{ type: "mrkdwn", text: `${alert.build} · ${alert.device} · 상태: ${statusText(status)} · 점검 \`${alert.runId}\`` }] },
    ...fixPrContext(status),
    ...alertActionBlocks(alert.key, status, fixPr),
  ];
}

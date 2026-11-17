import type { IssueKind } from "@device-farm/core/issues/issue";
import type { DailyIssue } from "@device-farm/core/report/daily";
import type { AlertStatus } from "@device-farm/core/slack/policy-alert";

import { t } from "./i18n";

/** 점검이 찾은 오류 종류를 사람 말로(봇 점검·탐색이 같이 쓴다) */
const labels = (): Record<string, string> => ({
  "app-error": t("오류 화면", "Error screen"),
  crash: t("앱 멈춤", "App crash"),
  console: t("콘솔 오류", "Console error"),
  network: t("요청 실패", "Request failed"),
  blank: t("빈 화면", "Blank screen"),
  "login-redirect": t("로그인으로 튕김", "Bounced to login"),
  stuck: t("눌러도 반응 없음(반복)", "No response to taps (repeated)"),
  layout: t("화면 깨짐", "Broken layout"),
  overflow: t("가로 넘침", "Horizontal overflow"),
  offscreen: t("화면 밖 요소", "Off-screen element"),
  "bottom-covered": t("하단 가림", "Bottom covered"),
});

export const issueLabel = (kind: string) => labels()[kind] ?? kind;

/** 「문제」 유형 이름(core `issueKindLabels`의 화면 언어판) */
export const issueKindLabel = (kind: IssueKind): string =>
  ({
    "app-error": t("앱 오류", "App error"),
    behavior: t("동작 오류", "Broken flow"),
    policy: t("정책 위반", "Policy violation"),
    design: t("디자인 오류", "Design mismatch"),
    docs: t("문서 갱신", "Docs update"),
    unverified: t("확인 필요", "Needs review"),
  })[kind];

/** 누가 봐야 하는지 한 줄 */
export const issueKindHint = (kind: IssueKind): string =>
  ({
    "app-error": t("화면이 안 열리거나 오류가 났어요", "A screen didn't open or showed an error"),
    behavior: t("누르거나 이동하는 흐름이 막혔어요", "A tap or navigation flow got stuck"),
    policy: t("정책·피그마와 앱 화면이 달라요", "The app differs from the policy or Figma"),
    design: t("피그마 시안과 화면이 달라요", "The screen differs from the Figma design"),
    docs: t("앱은 맞는데 정책서나 피그마가 뒤처졌어요", "The app is right, but the policy doc or Figma is outdated"),
    unverified: t("자동으로 판단하지 못했어요. 화면을 직접 봐 주세요", "Couldn't decide automatically. Please check the screen yourself"),
  })[kind];

/** 알림 처리 상태 */
export const alertStatusLabel = (status: AlertStatus): string =>
  ({
    open: t("확인 필요", "Needs review"),
    checking: t("확인 중", "Checking"),
    done: t("처리 완료", "Resolved"),
    "not-issue": t("문제 아님", "Not an issue"),
  })[status];

/** 아침 요약(Claude)이 붙인 문제 종류 */
export const dailyKindLabel = (kind: DailyIssue["kind"]): string =>
  ({
    "app-bug": t("앱", "App"),
    data: t("데이터", "Data"),
    design: t("디자인", "Design"),
    unverified: t("확인 필요", "Needs review"),
    "farm-false-positive": t("디바이스팜 오탐", "Farm false positive"),
    flaky: t("일시적", "Flaky"),
  })[kind];

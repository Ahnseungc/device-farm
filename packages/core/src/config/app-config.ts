/**
 * 점검 대상 앱 설정. 앱마다 다른 값(패키지 id·웹 주소·탭·금지어·시나리오…)은 전부 여기서만 받는다.
 * 사용자 프로젝트 루트의 `farm.config.ts`(또는 `FARM_CONFIG` 경로)가 `defineAppConfig()`로 내보낸다.
 * 브라우저(apps/web)도 읽으므로 node 모듈을 쓰지 않는다. 전역으로 들고 있지 않고 인자로 넘긴다.
 */
import type { BuildKind } from "../device/types";
import type { QaScreen } from "../qa/rules";
import type { ScreenScenario } from "../scenarios";

export type GuardMethod = "POST" | "PUT" | "PATCH" | "DELETE";

/** 디바이스팜 화면(apps/web) 언어. 기본 한국어, `FARM_LOCALE=en`으로도 바꾼다 */
export type FarmLocale = "ko" | "en";
export const farmLocales = ["ko", "en"] as const satisfies readonly FarmLocale[];
export const defaultFarmLocale: FarmLocale = "ko";

export function isFarmLocale(value: unknown): value is FarmLocale {
  return typeof value === "string" && (farmLocales as readonly string[]).includes(value);
}

/** 가드가 금지어보다 먼저 통과시키는 쓰기 요청. `{x}`는 슬래시 없는 한 칸 */
export interface AllowedRequest {
  method: GuardMethod;
  path: string;
}

/** 하단 탭·홈·뒤로처럼 화면 이동 규칙. 지도 빌더(브라우저)·드라이버·카오스가 같이 쓴다 */
export interface AppNavigation {
  /** 홈 탭을 누르면 도착하는 경로. 플로우의 시작점 */
  homePath: string;
  /** 하단 탭바(웹 링크)의 홈 탭 이름 */
  homeTabName: string;
  /** 하단 탭 이름 → 도착 경로. 홈 탭을 포함한다 */
  tabPaths: Record<string, string>;
  /** 앱 화면 상단 뒤로 버튼 이름(aria-label 등) */
  inPageBackNames: string[];
}

export interface GuardConfig {
  /** 탐색·버튼 눌러보기·카오스가 누르지 않는 버튼 낱말(부분 일치, 공백 무시) */
  forbiddenButtonWords: string[];
  /** 플로우 스텝으로 쓸 수 없는 버튼 이름(정확히 일치) */
  forbiddenClickNames: string[];
  /** 허용 목록에 allow로 있어도 막는 쓰기 API 경로 */
  forbiddenApiPatterns: RegExp[];
  /** 앱이 켜질 때마다 보내는 요청(푸시 토큰 저장 등). 금지어보다 먼저 통과시킨다 */
  pushTokenRequests: AllowedRequest[];
  /** 카오스·탐색이 누르지 않는 광고·외부 링크 이름 */
  avoidedNamePattern: RegExp;
  /** 누르지 않고 나가기만 하는 경로(비밀번호·PIN) */
  noPressPathPattern: RegExp;
}

export interface ConfluencePolicySource {
  /** api.atlassian.com/ex/confluence/<cloudId> 게이트웨이용 */
  cloudId: string;
  spaceKey: string;
  /** 제목에 이 말이 든 페이지를 정책 정본으로 본다 */
  titleQuery: string;
  /** 사람이 열어 볼 위키 주소(`https://<site>.atlassian.net/wiki`) */
  siteUrl: string;
}

export interface FigmaConfig {
  /** 화면 → 피그마 노드를 뽑을 프론트 체크아웃(Next.js App Router). 비면 `FLOW_PRD_ROOT` */
  frontRepo?: string;
  /** 앱이 실제로 배포되는 원격 브랜치 */
  ref: string;
  /** 라우트 폴더(App Router `app`) */
  appDir: string;
}

export type InstallSourceKind = "firebase" | "testflight";

export interface InstallConfig {
  /** 빌드를 어디서 받나. 비면 전부 firebase */
  sources?: Partial<Record<"android" | "ios", Partial<Record<BuildKind, InstallSourceKind>>>>;
  /** Firebase App Distribution 앱 id. 비면 `FIREBASE_APP_<PLATFORM>_<KIND>` 환경 변수 */
  firebase?: Partial<Record<"android" | "ios", Partial<Record<BuildKind, string>>>>;
  /** TestFlight 앱 목록에 보이는 dev 앱 이름(이전 빌드 설치에 쓴다) */
  testflightDevAppName?: string;
}

export interface AppConfig extends AppNavigation {
  name: string;
  /** 디바이스팜 화면 언어. 기본 "ko". 환경 변수 `FARM_LOCALE`이 있으면 그것이 이긴다 */
  locale: FarmLocale;
  /** Android 패키지 = iOS 번들 id. 플랫폼마다 다르면 `iosBundleIds`로 덮는다 */
  appIds: Record<BuildKind, string>;
  iosBundleIds?: Partial<Record<BuildKind, string>>;
  /** 앱 WebView가 여는 웹 주소. 비우면 `FARM_WEB_ORIGIN_DEV`·`FARM_WEB_ORIGIN_PROD` */
  web: Record<BuildKind, string>;
  /** API 호스트가 웹과 다르면 넣는다. 탐색이 내부로 본다 */
  apiOrigin: string;
  /** 로그인 화면 경로. 여기로 튕기면 로그인이 풀린 것으로 본다 */
  loginPaths: string[];
  /** 화면에 보이면 앱 오류로 보는 문구 */
  appErrorText: string;
  /** 시나리오 경로 → `scheme://path` 딥링크. 경로가 `/`면 `scheme://<homeHost>` */
  deepLink: { scheme: string; homeHost: string };
  android: {
    /** 앱 WebView가 사는 액티비티. 다른 액티비티(네이티브 화면)가 위면 뒤로 키로 닫는다. 비면 닫지 않는다 */
    mainActivity?: string;
  };
  webview: {
    /** 열린 스택 화면을 전부 닫는 페이지 스크립트(앱 브리지). 비면 닫지 않는다 */
    stackResetScript?: string;
    /** 탭 화면에 뜬 바텀시트·팝업 닫기 버튼 이름 */
    sheetCloseName: string;
  };
  guard: GuardConfig;
  /** 고정 주소 화면 점검 목록 */
  scenarios: ScreenScenario[];
  /** 앞 단계가 있어야 의미 있는 화면(완료·중간 단계). 점검에서 뺀다 */
  excludedScenarioPaths: string[];
  /** 화면 데이터 QA. `sessionPath`는 로그인 세션(`{ user: { id, accessToken } }`)을 주는 웹 경로 */
  qa: { screens: QaScreen[]; sessionPath: string };
  policy: { confluence?: ConfluencePolicySource };
  figma: FigmaConfig;
  install: InstallConfig;
  ios: {
    /** WDA 서명 팀. 비면 `IOS_TEAM_ID` */
    teamId?: string;
    /** WDA 번들 id. 비면 `IOS_WDA_BUNDLE_ID`, 그것도 비면 `com.example.WebDriverAgentRunner` */
    wdaBundleId?: string;
  };
  /** 디바이스팜 화면에 들어올 수 있는 Tailscale 계정 도메인. 비면 로컬 접속만 */
  access: { allowedDomains: string[] };
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends RegExp | unknown[] ? T[K] : T[K] extends object ? DeepPartial<T[K]> : T[K] };

/** `farm.config.ts`가 적는 모양. 필수는 이름·앱 id·홈·탭뿐이다 */
export type AppConfigInput = Pick<AppConfig, "name" | "appIds" | "homePath" | "homeTabName" | "tabPaths"> &
  DeepPartial<Omit<AppConfig, "name" | "appIds" | "homePath" | "homeTabName" | "tabPaths" | "guard">> & {
    /** 기본 금지어·금지 경로에 덧붙인다(기본을 지우지 않는다) */
    guard?: Partial<Pick<GuardConfig, "pushTokenRequests" | "avoidedNamePattern" | "noPressPathPattern">> & {
      extraForbiddenButtonWords?: string[];
      extraForbiddenClickNames?: string[];
      extraForbiddenApiPatterns?: RegExp[];
    };
  };

/** 되돌릴 수 없는 돈·계정 동작. 앱과 상관없이 누르지 않는다 (작성자 판단) */
export const defaultForbiddenButtonWords = [
  "구매", "결제", "매도", "매수", "송금", "출금", "탈퇴", "배송 신청", "주문",
  "환불", "해지", "삭제", "인출", "선물", "충전", "로그아웃", "공유하기",
  "Buy", "Pay", "Checkout", "Delete account", "Log out", "Sign out",
] as const;

export const defaultForbiddenClickNames = [
  "신청", "신청하기", "결제", "결제하기", "구매하기", "판매하기", "출금", "탈퇴", "탈퇴하기", "본인인증", "송금", "이체",
] as const;

/**
 * 주문·결제·매도·송금·출금·계좌·탈퇴·배송 신청 경로. 부분 문자열, 대소문자 무시.
 * 일부러 넓게 잡았다. 과하게 막히면 탐색이 덜 될 뿐 사고는 나지 않는다.
 */
export const defaultForbiddenApiPatterns: readonly RegExp[] = [
  /order/i, // 주문
  /pay/i, // payment, pay
  /purchase|buy|checkout|billing/i, // 구매·결제
  /sell|sale/i, // 매도·판매
  /trade|exchange/i, // 매매·교환
  /transfer|remit|send-?money|gift/i, // 송금·선물(자산 이전)
  /withdraw|cash-?out|redeem|refund|deposit/i, // 출금·환불·입금
  /account|bank/i, // 계좌·계정 삭제
  /resign|leave|secession|unregister|deregister|quit/i, // 탈퇴
  /delivery|shipping|shipment/i, // 배송 신청
  /(^|\/)cards?(\/|$)|card-?regist/i, // 카드 등록
];

/** 광고·디버그 칩·스토어 설치 버튼. 무작위 클릭이 무효 트래픽이 되거나 앱 밖으로 나간다 */
export const defaultAvoidedNamePattern = /광고|Google Ads|AdMob|Dismiss|What is this|^설치$|^Install$/i;
export const defaultNoPressPathPattern = /password|\/pin(\/|$)/i;

export const defaultInPageBackNames = ["뒤로가기", "Back"];
export const defaultLoginPaths = ["/login"];
/** Next.js가 클라이언트 오류 때 그리는 문구 */
export const defaultAppErrorText = "Application error";

export function defineAppConfig(input: AppConfigInput): AppConfig {
  const guard = input.guard ?? {};
  return {
    name: input.name,
    locale: isFarmLocale(input.locale) ? input.locale : defaultFarmLocale,
    appIds: input.appIds,
    iosBundleIds: input.iosBundleIds,
    web: { dev: input.web?.dev ?? "", prod: input.web?.prod ?? "" },
    apiOrigin: input.apiOrigin ?? "",
    homePath: input.homePath,
    homeTabName: input.homeTabName,
    tabPaths: { [input.homeTabName]: input.homePath, ...input.tabPaths },
    inPageBackNames: input.inPageBackNames ?? [...defaultInPageBackNames],
    loginPaths: input.loginPaths ?? [...defaultLoginPaths],
    appErrorText: input.appErrorText ?? defaultAppErrorText,
    deepLink: { scheme: input.deepLink?.scheme ?? "", homeHost: input.deepLink?.homeHost ?? "home" },
    android: { mainActivity: input.android?.mainActivity },
    webview: { stackResetScript: input.webview?.stackResetScript, sheetCloseName: input.webview?.sheetCloseName ?? "닫기" },
    guard: {
      forbiddenButtonWords: [...defaultForbiddenButtonWords, ...(guard.extraForbiddenButtonWords ?? [])],
      forbiddenClickNames: [...defaultForbiddenClickNames, ...(guard.extraForbiddenClickNames ?? [])],
      forbiddenApiPatterns: [...defaultForbiddenApiPatterns, ...(guard.extraForbiddenApiPatterns ?? [])],
      pushTokenRequests: guard.pushTokenRequests ?? [],
      avoidedNamePattern: guard.avoidedNamePattern ?? defaultAvoidedNamePattern,
      noPressPathPattern: guard.noPressPathPattern ?? defaultNoPressPathPattern,
    },
    scenarios: (input.scenarios as ScreenScenario[] | undefined) ?? [],
    excludedScenarioPaths: input.excludedScenarioPaths ?? [],
    qa: { screens: (input.qa?.screens as QaScreen[] | undefined) ?? [], sessionPath: input.qa?.sessionPath ?? "/api/auth/session" },
    policy: { confluence: input.policy?.confluence as ConfluencePolicySource | undefined },
    figma: { frontRepo: input.figma?.frontRepo, ref: input.figma?.ref ?? "origin/main", appDir: input.figma?.appDir ?? "app" },
    install: { sources: input.install?.sources, firebase: input.install?.firebase, testflightDevAppName: input.install?.testflightDevAppName },
    ios: { teamId: input.ios?.teamId, wdaBundleId: input.ios?.wdaBundleId },
    access: { allowedDomains: input.access?.allowedDomains ?? [] },
  };
}

/** 플랫폼별 앱 id. iOS 번들 id가 따로 있으면 그것 */
export function appIdFor(app: Pick<AppConfig, "appIds" | "iosBundleIds">, kind: BuildKind, platform: "android" | "ios" = "android"): string {
  return (platform === "ios" ? app.iosBundleIds?.[kind] : undefined) ?? app.appIds[kind];
}

/** 앱 id로 빌드 종류를 찾는다. 모르는 id면 dev */
export function kindOfAppId(app: Pick<AppConfig, "appIds" | "iosBundleIds">, appId: string): BuildKind {
  return appId === app.appIds.prod || appId === app.iosBundleIds?.prod ? "prod" : "dev";
}

/** 브라우저 화면에 내려 줄 값(정규식·함수 없는 JSON) */
export interface PublicAppConfig extends AppNavigation {
  name: string;
  locale: FarmLocale;
  forbiddenClickNames: string[];
}

export function publicAppConfig(app: AppConfig): PublicAppConfig {
  return {
    name: app.name,
    locale: app.locale ?? defaultFarmLocale,
    homePath: app.homePath,
    homeTabName: app.homeTabName,
    tabPaths: app.tabPaths,
    inPageBackNames: app.inPageBackNames,
    forbiddenClickNames: app.guard.forbiddenClickNames,
  };
}

/** 하단 탭 이름. 홈 탭이 맨 앞 */
export function tabNamesOf(nav: Pick<AppNavigation, "homeTabName" | "tabPaths">): string[] {
  return [nav.homeTabName, ...Object.keys(nav.tabPaths).filter((name) => name !== nav.homeTabName)];
}

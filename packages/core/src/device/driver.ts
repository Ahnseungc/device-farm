import { homeTabLabelsOf, type AppConfig, type AppNavigation } from "../config/app-config";

/** 플랫폼마다 구현이 다른 화면 조작. 경로는 앱 WebView가 쓰는 웹 주소 기준이다. */
export interface ScreenDriver {
  /** 이 드라이버가 여는 앱 설정. 홈·로그인·오류 문구 판정이 여기서 읽는다 */
  app: AppConfig;
  navigate(path: string): Promise<void>;
  /** role을 안 주면 button. link는 하단 탭처럼 a[href]·role=link. */
  /** match가 prefix면 이름이 name으로 시작하는 요소. 이름에 데이터가 들어가는 버튼(「Lv. 2 …」)용 */
  clickButton(name: string, role?: ClickRole, match?: ClickMatch): Promise<void>;
  /** 열린 스택을 닫고 하단 홈 탭(`app.homeTabName`)으로. 플로우의 시작점(딥링크를 쓰지 않는다). */
  goHome?(): Promise<void>;
  /** 앱을 끄고 다시 켠다. 앱 진입 배너의 「오늘 하루 보지 않기」·잠깐 숨김 기록을 먼저 지워 다시 뜨게 한다. 없으면 플로우 relaunch 스텝을 못 쓴다 */
  relaunch?(): Promise<void>;
  /**
   * 앱 웹 화면이 네트워크 오류 화면(「웹페이지를 사용할 수 없음」, net::ERR_…)이면 다시 불러 본다.
   * none: 오류 화면 없음. recovered: 다시 불러 고침. failed: 끝내 못 고침(code에 오류 코드)
   */
  recoverNetwork?(): Promise<NetworkRecovery>;
  /** 앱 웹 화면 중 게이트웨이 오류 화면(배포 중 502 등)이 있으면 그 상태 줄, 없으면 null. 쉬는 기기 감시가 쓴다 */
  gatewayError?(): Promise<string | null>;
  /** 마지막에 누른 자리와 지금 열린 웹 화면 목록. 실패 기록에 남긴다. 없으면 남기지 않는다 */
  tapTrace?(): Promise<string>;
  /** 화면에 그려진 글자 중 지금 읽는 웹 화면에 없는 것이 얼마나 되나. 다른 웹 화면을 읽고 있는지 가른다. 몇 초 걸려 실패했을 때만 부른다 */
  screenMismatch?(): Promise<string>;
  /** 개발용 스플래시 미리보기(dev 빌드, 네이티브)가 화면을 덮고 있으면 닫는다. 닫았으면 true. 3초쯤 걸려 기준과 다를 때만 부른다 */
  closeDevPreview?(): Promise<boolean>;
  /** 맨 위 페이지의 CSS px 자리를 사람처럼 누른다(팝업 바깥 딤 닫기). 없으면 팝업은 버튼으로만 닫는다 */
  tapAt?(x: number, y: number): Promise<void>;
  /**
   * 광고 버튼을 누른 뒤 부른다. 네이티브 광고 화면이 뜨면 끝날 때까지 보고 사람처럼 닫아 앱으로 돌아온다.
   * 광고 화면이 끝내 안 뜨면 shown false(웹 안 광고·광고 없음 — 적립은 부른 쪽이 잔액으로 본다).
   */
  watchAd?(): Promise<AdWatch>;
  expectText(text: string, timeoutMs: number): Promise<void>;
  currentPath(): Promise<string>;
  /** 지금 화면이 앱 웹 주소인가. 바깥 사이트(본인인증 등)면 false. 모르면 없음 */
  onAppSite?: () => Promise<boolean>;
  hasText(text: string): Promise<boolean>;
  /** 기기 전체 화면 PNG */
  screenshot(): Promise<Buffer>;
  evaluate<T>(script: string): Promise<T>;
  close(): Promise<void>;
}

export type ClickRole = "button" | "link";
/** 광고 보기 결과. closedBy: 닫은 방법(「Close」 누름, 뒤로 가기 등) */
export type AdWatch = { shown: false } | { shown: true; seconds: number; closedBy: string };
export type NetworkRecovery = { status: "none" } | { status: "recovered"; code: string } | { status: "failed"; code: string };
/** WebView가 오류 화면을 띄우면 페이지 주소가 이것으로 바뀐다(앱 웹 주소가 아니게 된다) */
export const webErrorUrlPrefix = "chrome-error://";
/** 오류 화면을 다시 불러 보는 간격(앞부터, 작성자 판단). 와이파이가 잠깐 끊긴 것은 보통 몇 초 안에 돌아온다 */
export const networkRetryDelaysMs = [2_000, 5_000, 10_000] as const;
/** 오류 화면 글자에서 오류 코드(net::ERR_CONNECTION_TIMED_OUT). 없으면 「알 수 없는 네트워크 오류」 */
export function webErrorCode(text: string): string {
  return /net::ERR_[A-Z_]+/.exec(text)?.[0] ?? "알 수 없는 네트워크 오류";
}
/** exact: 이름이 같다(기본). prefix: 이름이 이 글자로 시작한다 */
export type ClickMatch = "exact" | "prefix";

/** 누를 때 찾아볼 글자들. 홈 탭(어느 이름이든)이면 홈 탭에 적힐 수 있는 글자 전부, 아니면 그 이름 하나 */
export function clickLabels(nav: Pick<AppNavigation, "homeTabName" | "homeTabLabels">, name: string, role: ClickRole = "button"): readonly string[] {
  const labels = homeTabLabelsOf(nav);
  if (role === "link" && (name === nav.homeTabName || labels.includes(name))) return labels;
  return [name];
}
/** 홈 탭으로 가기를 시도하는 횟수 (작성자 판단). 실패마다 화면 상단 뒤로 버튼을 한 번 누른다(Android·iOS 같다) */
export const homeAttempts = 3;

export function isLoginPath(path: string, loginPaths: readonly string[]): boolean {
  return loginPaths.some((login) => path === login || path.startsWith(`${login}/`) || path.startsWith(`${login}?`));
}

/** 게이트웨이 오류 화면(배포 중 502 등)을 다시 불러오는 간격 (작성자 판단) */
export const gatewayReloadWaitMs = 10_000;
/** 게이트웨이 오류 화면이 이만큼 이어지면 포기한다. dev 프론트 배포가 보통 1~3분 걸린다 (작성자 판단) */
export const gatewayGiveUpMs = 300_000;
/**
 * 게이트웨이 오류 화면이 이만큼 다시 불러와도 안 풀리면 앱을 한 번 껐다 켠다 (작성자 판단).
 * 다시 불러오기는 그 화면 하나만 새로 받는다. 배포 전 코드가 남은 뒤쪽 화면·WebView 상태까지 지우려면 앱을 다시 켜야 한다.
 */
export const gatewayRelaunchAfterMs = 30_000;

/**
 * 웹 서버(nginx)가 돌려준 게이트웨이 오류 화면이면 그 상태 줄(「502 Bad Gateway」), 아니면 null.
 */
export function gatewayErrorOf(bodyText: string): string | null {
  const match = /^\s*(50[234] (?:Bad Gateway|Service (?:Temporarily )?Unavailable|Gateway Time-?out))\b/i.exec(bodyText);
  return match ? match[1] : null;
}

/** 끝내 안 풀린 게이트웨이 오류의 실패 사유. `what`은 기다리던 것(「"출금하기" 문구」) */
export const gatewayFailureMessage = (what: string, gateway: string) =>
  `${what} 대신 웹 서버 오류 화면(${gateway})이 보였습니다. ${gatewayGiveUpMs / 1000}초 동안 다시 불러와도 같았습니다(서버 배포 중일 수 있음).`;

export interface GatewayWaitDeps {
  /** 지금 화면 본문 글자. 못 읽으면 빈 글자 */
  bodyText(): Promise<string>;
  reload(): Promise<void>;
  sleep(ms: number): Promise<void>;
  log(message: string): void;
  now?: () => number;
  /** 앱을 껐다 켜고 막혔던 화면으로 다시 들어간다. 없으면 다시 불러오기만 한다 */
  relaunch?(): Promise<void>;
}

/**
 * 화면이 게이트웨이 오류(배포 중 502 등)면 풀릴 때까지 다시 불러온다. 풀리면(또는 오류가 아니면) null, `gatewayGiveUpMs` 동안 안 풀리면 그 상태 줄.
 * `gatewayRelaunchAfterMs` 동안 안 풀리면 앱을 한 번 다시 켜고(`relaunch`) 계속 기다린다.
 * Android·iOS 드라이버가 같이 쓴다.
 */
export async function waitOutGateway(deps: GatewayWaitDeps): Promise<string | null> {
  const now = deps.now ?? Date.now;
  const giveUpAt = now() + gatewayGiveUpMs;
  const relaunchAt = now() + gatewayRelaunchAfterMs;
  let logged = false;
  let relaunched = false;
  for (;;) {
    const gateway = gatewayErrorOf(await deps.bodyText().catch(() => ""));
    if (!gateway) return null;
    if (now() >= giveUpAt) return gateway;
    if (deps.relaunch && !relaunched && now() >= relaunchAt) {
      relaunched = true;
      deps.log(`웹 서버 오류 화면(${gateway})이 ${gatewayRelaunchAfterMs / 1000}초 동안 안 풀려 앱을 다시 켜고 그 화면으로 다시 들어갑니다.`);
      await deps.relaunch().catch((error: unknown) => deps.log(`앱 다시 켜기 실패: ${error instanceof Error ? error.message : String(error)}`));
      continue;
    }
    if (!logged) {
      logged = true;
      deps.log(`웹 서버 오류 화면(${gateway})이라 배포가 끝나길 기다리며 다시 불러옵니다(최대 ${gatewayGiveUpMs / 1000}초).`);
    }
    await deps.reload().catch(() => undefined);
    await deps.sleep(gatewayReloadWaitMs);
  }
}

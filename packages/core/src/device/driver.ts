import type { AppConfig } from "../config/app-config";

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
  expectText(text: string, timeoutMs: number): Promise<void>;
  currentPath(): Promise<string>;
  hasText(text: string): Promise<boolean>;
  /** 기기 전체 화면 PNG */
  screenshot(): Promise<Buffer>;
  evaluate<T>(script: string): Promise<T>;
  close(): Promise<void>;
}

export type ClickRole = "button" | "link";
/** exact: 이름이 같다(기본). prefix: 이름이 이 글자로 시작한다 */
export type ClickMatch = "exact" | "prefix";
/** 홈 탭으로 가기를 시도하는 횟수 (작성자 판단). 실패마다 화면 상단 뒤로 버튼을 한 번 누른다(Android·iOS 같다) */
export const homeAttempts = 3;

export function isLoginPath(path: string, loginPaths: readonly string[]): boolean {
  return loginPaths.some((login) => path === login || path.startsWith(`${login}/`) || path.startsWith(`${login}?`));
}

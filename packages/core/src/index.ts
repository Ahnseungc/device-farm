/**
 * npm 패키지(`@ahnseungchan/device-farm`) 루트 진입점. 사용자 `farm.config.ts`가 불러오는 설정 함수·타입·데이터 QA 도우미만 내보낸다.
 * 기기·서버 코드는 여기서 내보내지 않는다(설정 파일이 playwright·webdriverio를 불러오지 않게).
 */
export {
  defaultForbiddenApiPatterns,
  defaultForbiddenButtonWords,
  defaultForbiddenClickNames,
  defineAppConfig,
  type AllowedRequest,
  type AppConfig,
  type AppConfigInput,
  type AppNavigation,
  type ConfluencePolicySource,
  type FigmaConfig,
  type GuardConfig,
  type GuardMethod,
  type InstallConfig,
  type InstallSourceKind,
} from "./config/app-config";
export type { BuildKind } from "./device/types";
export { equalWon, formatWon, numberAt, pick, textHas, type QaCheck, type QaContext, type QaRule, type QaScreen, type ScreenApis } from "./qa/rules";
export type { ScreenScenario } from "./scenarios";

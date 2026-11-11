/** 고정 주소 화면 하나. 목록은 앱 설정(`AppConfig.scenarios`)에서 받는다. */
export type ScreenScenario = {
  path: string;
  name: string;
  when: string;
  then: string;
};

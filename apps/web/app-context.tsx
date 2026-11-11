import { createContext, useContext, type ReactNode } from "react";

import type { PublicAppConfig } from "@device-farm/core/config/app-config";

/** 서버가 읽은 앱 설정 중 화면이 쓰는 값(홈·탭·금지 버튼). App이 한 번 받아 내려 준다 */
const AppConfigContext = createContext<PublicAppConfig | null>(null);

export function AppConfigProvider({ value, children }: { value: PublicAppConfig; children: ReactNode }) {
  return <AppConfigContext.Provider value={value}>{children}</AppConfigContext.Provider>;
}

export function useAppConfig(): PublicAppConfig {
  const value = useContext(AppConfigContext);
  if (!value) throw new Error("AppConfigProvider 밖에서 앱 설정을 읽었습니다.");
  return value;
}

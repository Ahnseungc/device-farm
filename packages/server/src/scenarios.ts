import type { AppConfig } from "@device-farm/core/config/app-config";
import type { ScreenScenario } from "@device-farm/core/scenarios";

/**
 * 디바이스팜 화면 점검이 도는 시나리오: 앱 설정 `scenarios`에서 `excludedScenarioPaths`를 뺀 것.
 * 앞 단계(퍼널 진행·주문·결제)가 있어야 의미 있는 완료·결과·중간 단계 화면은 고정 주소 딥링크로 열면
 * 앱이 상위로 리다이렉트하므로 설정에서 뺀다. 쿼리로 상태를 미리 넣어 혼자 열리는 화면은 남긴다.
 */
export function farmScenarios(app: Pick<AppConfig, "scenarios" | "excludedScenarioPaths" | "uncheckedPathPrefixes">): ScreenScenario[] {
  const excluded = new Set(app.excludedScenarioPaths);
  return app.scenarios.filter((scenario) => !excluded.has(scenario.path) && !isUncheckedPath(scenario.path, app.uncheckedPathPrefixes));
}

/** 어떤 점검(화면·정책·버튼)에도 넣지 않는 경로인가(`AppConfig.uncheckedPathPrefixes`) */
export function isUncheckedPath(path: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(`${prefix}?`));
}

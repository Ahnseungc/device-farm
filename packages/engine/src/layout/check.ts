import type { ScreenDriver } from "@device-farm/core/device/driver";
import { layoutChecks, layoutScript, parseLayoutFacts } from "@device-farm/core/layout/layout";
import type { QaCheck } from "@device-farm/core/qa/rules";

/** 화면 없이 네이티브로 넘기기만 하는 다리 페이지 — 비어 있는 게 정상이다 */
export const blankByDesignPaths: readonly string[] = ["/oauth-native-bridge"];

/** 지금 열린 화면의 배치를 잰다. 재지 못하면(이동 중·네이티브 화면) 빈 목록 — 배치는 부가 점검이라 화면 결과를 바꾸지 않는다 */
export async function checkLayout(driver: ScreenDriver, screenPath: string, log: (message: string) => void = () => {}): Promise<QaCheck[]> {
  try {
    const checks = layoutChecks(parseLayoutFacts(await driver.evaluate<string>(layoutScript)));
    return blankByDesignPaths.includes(screenPath) ? checks.filter((check) => check.id !== "layout-blank") : checks;
  } catch (error) {
    log(`화면 깨짐 측정 실패: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

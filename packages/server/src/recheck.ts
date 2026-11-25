import type { DeviceScreen } from "@device-farm/core/device/types";

/** 시나리오를 고친 뒤 다시 점검한 플로우 결과 요약(슬랙 「수정 PR 만들기」). 점검 못 함은 통과로 치지 않는다 */
export function recheckSummary(screens: readonly DeviceScreen[]): { passed: boolean; note: string } {
  if (screens.length === 0) return { passed: false, note: "돌린 플로우가 없어요(연결된 기기가 없을 수 있어요)." };
  const failed = screens.filter((screen) => screen.status === "failed");
  if (failed.length > 0) return { passed: false, note: `플로우 ${screens.length}개 중 ${failed.length}개 실패: ${failed.map((screen) => screen.message ?? screen.scenario).join(" / ").slice(0, 300)}` };
  const unsure = screens.filter((screen) => screen.status !== "passed").length;
  if (unsure > 0) return { passed: false, note: `플로우 ${screens.length}개 중 점검 못 함 ${unsure}개(기기·연결)` };
  return { passed: true, note: `플로우 ${screens.length}개 통과` };
}

// 정책·피그마 대조를 기기 한 대에서 바로 돌린다(점검 전체를 돌리지 않고): npm run policy-check -- --device <id> [--path /my/orders]
// 뽑은 규칙(test-results/policy/rules)·피그마 캐시·프론트 연결을 쓴다. 결과는 콘솔에만 낸다.
import { appIdFor } from "@device-farm/core/config/app-config";
import { findingLabels } from "@device-farm/core/policy/rules";
import { execFileText } from "@device-farm/devices/exec";
import { listDevices } from "@device-farm/devices/registry";
import { askClaude } from "@device-farm/engine/policy/claude";
import { readFrontFigmaMap } from "@device-farm/engine/policy/front-figma";
import { readAllPageRules, readFigmaCache, readIgnores } from "@device-farm/engine/policy/rules-store";
import { checkPolicyScreen, policyScreens } from "@device-farm/engine/policy/screen-check";
import { readScreenMap } from "@device-farm/engine/screen-map-store";
import { openDriver } from "@device-farm/server/devices";
import { farmScenarios } from "@device-farm/server/scenarios";

import { cliApp } from "./app";

function option(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const app = await cliApp();
  const deviceId = option("device");
  const device = (await listDevices(execFileText, app.appIds.dev, app.iosBundleIds?.dev)).find((item) => item.id === deviceId);
  if (!device) throw new Error(`연결된 기기가 아닙니다: ${deviceId ?? "(--device 없음)"}`);
  const edges = readScreenMap().edges;
  const known = [...new Set([...farmScenarios(app).map((scenario) => scenario.path), ...edges.map((edge) => edge.from)])];
  const path = option("path");
  const screens = policyScreens(readAllPageRules(), known, readFigmaCache(), readFrontFigmaMap()?.routes).filter((screen) => !path || screen.path === path);
  if (screens.length === 0) throw new Error("정책 규칙이 걸린 화면이 없습니다.");

  const driver = await openDriver(app, device, appIdFor(app, "dev", device.platform));
  let bugs = 0;
  try {
    for (const screen of screens) {
      const report = await checkPolicyScreen(driver, screen, { ask: askClaude, ignores: readIgnores() });
      console.log(`\n${screen.path} · 규칙 ${screen.rules.length}개 · 피그마 문구 ${screen.figma?.texts.length ?? 0}개${report.cached ? " · 판정 캐시" : ""}`);
      if (report.judgeError) console.log(`  판정 실패: ${report.judgeError}`);
      for (const check of report.checks.filter((item) => !item.ok)) {
        console.log(`  ${check.finding ? findingLabels[check.finding] : "피그마 차이"}${check.ignored ? "(무시)" : ""} ${check.title} — ${check.message ?? ""}`);
        if (check.finding === "bug-candidate" && !check.ignored) bugs += 1;
      }
      console.log(`  통과 ${report.checks.filter((item) => item.ok && !item.message).length}개 · 판단 불가 ${report.checks.filter((item) => item.ok && item.message).length}개 · 상황 필요 ${report.situational}개`);
    }
  } finally {
    await driver.close();
  }
  process.exitCode = bugs > 0 ? 1 : 0;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

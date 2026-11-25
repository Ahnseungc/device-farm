// 정책·피그마 대조를 기기 한 대에서 바로 돌린다(점검 전체를 돌리지 않고): npm run policy-check -- --device <id> [--path /my/orders] [--slack]
// --slack: 새 불일치를 점검이 끝났을 때처럼 슬랙(SLACK_CHANNEL_DEV)에 보낸다
// 뽑은 규칙·피그마 캐시(test-results/farm.db)·프론트 연결을 쓴다. 결과는 콘솔에 내고, 도는 동안 진행 중 실행으로 저장해 웹 플로팅·「정책」 탭에서도 본다.
import { appIdFor, type AppConfig } from "@device-farm/core/config/app-config";
import type { DeviceRun } from "@device-farm/core/device/types";
import { hasBugCandidate } from "@device-farm/core/policy/compare";
import { sameMeaningLabel } from "@device-farm/core/policy/judge";
import { findingLabels } from "@device-farm/core/policy/rules";
import { execFileText } from "@device-farm/devices/exec";
import { listDevices } from "@device-farm/devices/registry";
import { askClaude } from "@device-farm/engine/policy/claude";
import { readFrontFigmaMap } from "@device-farm/engine/policy/front-figma";
import { readAllPageRules, readFigmaCache, readFigmaPageOf, readIgnores } from "@device-farm/engine/policy/rules-store";
import { checkPolicyScreen, policyScreens, withScreenAliases } from "@device-farm/engine/policy/screen-check";
import { readSources } from "@device-farm/engine/policy/store";
import { policyScenarioPrefix } from "@device-farm/engine/run";
import { readScreenMap } from "@device-farm/engine/screen-map-store";
import { openDriver } from "@device-farm/server/devices";
import { farmScenarios } from "@device-farm/server/scenarios";
import { startSlackAlerts } from "@device-farm/server/slack-alerts";

import { cliApp } from "./app";
import { startCliRun } from "./cli-run";

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
  const screens = withScreenAliases(policyScreens(readAllPageRules(), known, readFigmaCache(), readFrontFigmaMap()?.routes, readFigmaPageOf()), readSources().screenAliases).filter(
    (screen) => !path || screen.path === path,
  );
  if (screens.length === 0) throw new Error("정책 규칙이 걸린 화면이 없습니다.");

  const driver = await openDriver(app, device, appIdFor(app, "dev", device.platform));
  const cli = startCliRun("정책 점검", device, screens.length);
  let bugs = 0;
  try {
    for (const screen of screens) {
      const name = `${policyScenarioPrefix}${screen.path}`;
      cli.current(name);
      // 화면 하나가 깨져도(이동 중 evaluate 실패 등) 나머지 화면은 본다
      const report = await checkPolicyScreen(driver, screen, { ask: askClaude, ignores: readIgnores() }).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        cli.push({ scenario: name, status: "failed", message, checks: [] });
        console.log(`\n${screen.path} · 점검 실패: ${message}`);
        return null;
      });
      if (!report) continue;
      cli.push({ scenario: name, status: hasBugCandidate(report.checks) ? "failed" : "passed", checks: report.checks });
      console.log(`\n${screen.path} · 규칙 ${screen.rules.length}개 · 피그마 문구 ${screen.figma?.texts.length ?? 0}개${report.cached ? " · 판정 캐시" : ""}${report.figmaCoverage === undefined ? "" : ` · 피그마 일치 ${Math.round(report.figmaCoverage * 100)}%`}`);
      if (report.judgeError) console.log(`  판정 실패: ${report.judgeError}`);
      for (const check of report.checks.filter((item) => !item.ok)) {
        console.log(`  ${check.finding ? findingLabels[check.finding] : "피그마 차이"}${check.ignored ? "(무시)" : ""} ${check.title} — ${check.message ?? ""}`);
        if (check.finding === "bug-candidate" && !check.ignored) bugs += 1;
      }
      const reworded = report.checks.filter((item) => item.ok && item.message?.startsWith(sameMeaningLabel));
      for (const check of reworded) console.log(`  ${check.title} — ${check.message}`);
      const unknown = report.checks.filter((item) => item.ok && item.message && !item.message.startsWith(sameMeaningLabel)).length;
      console.log(`  통과 ${report.checks.filter((item) => item.ok && !item.message).length}개 · ${sameMeaningLabel} ${reworded.length}개 · 판단 불가 ${unknown}개 · 상황 필요 ${report.situational}개`);
    }
  } finally {
    await driver.close();
    cli.finish();
  }
  if (process.argv.includes("--slack")) await sendToSlack(app, cli.run);
  process.exitCode = bugs > 0 ? 1 : 0;
}

/** 점검이 끝났을 때와 같은 경로로 새 불일치만 슬랙에 보낸다 */
async function sendToSlack(app: AppConfig, run: DeviceRun): Promise<void> {
  const slack = startSlackAlerts(app, (message) => console.log(`[slack] ${message}`));
  try {
    await slack.onRunFinished(run);
  } finally {
    slack.stop();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

// 화면 깨짐 점검을 기기 한 대에서 바로 돌린다: npm run layout-check -- --device <id> [--path /home] [--path ...] [--shots]
// 경로를 안 주면 화면 점검 시나리오 경로 전체. --shots: 실패 화면 스크린샷을 test-results/layout/ 에 남긴다.
// 도는 동안 진행 중 실행으로 저장해 웹 플로팅·결과 탭에서도 본다.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { appIdFor } from "@device-farm/core/config/app-config";
import { layoutMessage } from "@device-farm/core/layout/layout";
import { sleep } from "@device-farm/core/sleep";
import { execFileText } from "@device-farm/devices/exec";
import { listDevices } from "@device-farm/devices/registry";
import { checkLayout } from "@device-farm/engine/layout/check";
import { policySettleMs } from "@device-farm/engine/policy/screen-check";
import { layoutScenarioPrefix, pathSegment } from "@device-farm/engine/run";
import { openDriver } from "@device-farm/server/devices";
import { farmScenarios } from "@device-farm/server/scenarios";

import { cliApp } from "./app";
import { startCliRun } from "./cli-run";

const optionValues = (name: string) => process.argv.flatMap((arg, index) => (arg === `--${name}` && process.argv[index + 1] ? [process.argv[index + 1]] : []));

async function main(): Promise<void> {
  const app = await cliApp();
  const [deviceId] = optionValues("device");
  const device = (await listDevices(execFileText, app.appIds.dev, app.iosBundleIds?.dev)).find((item) => item.id === deviceId);
  if (!device) throw new Error(`연결된 기기가 아닙니다: ${deviceId ?? "(--device 없음)"}`);
  const paths = optionValues("path");
  const targets = paths.length > 0 ? paths : [...new Set(farmScenarios(app).map((scenario) => scenario.path))];
  const shots = process.argv.includes("--shots");
  const driver = await openDriver(app, device, appIdFor(app, "dev", device.platform));
  const cli = startCliRun("화면 깨짐 점검", device, targets.length);
  let failed = 0;
  try {
    for (const target of targets) {
      const name = `${layoutScenarioPrefix}${target}`;
      cli.current(name);
      await driver.navigate(target);
      await sleep(policySettleMs);
      const checks = await checkLayout(driver, target, (message) => console.log(`  ${message}`));
      const message = layoutMessage(checks);
      console.log(`${target} · ${checks.length === 0 ? "측정 못 함" : (message ?? "통과")}`);
      if (!message) {
        cli.push({ scenario: name, status: "passed", message: checks.length === 0 ? "측정 못 함" : undefined, checks });
        continue;
      }
      failed += 1;
      let screenshot: string | undefined;
      if (shots) {
        const file = path.resolve("test-results/layout", `${pathSegment(target)}.png`);
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, await driver.screenshot());
        screenshot = path.relative(path.resolve("test-results"), file).split(path.sep).join("/");
      }
      cli.push({ scenario: name, status: "failed", message, checks, screenshot });
    }
  } finally {
    await driver.close();
    cli.finish();
  }
  console.log(`\n화면 깨짐 ${failed}개 화면 / ${targets.length}개`);
  process.exitCode = failed > 0 ? 1 : 0;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

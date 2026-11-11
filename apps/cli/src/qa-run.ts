// 화면 데이터 QA를 기기 한 대에서 돌린다: npm run qa -- --device <id> [--path /home]
// 화면·규칙은 앱 설정 qa.screens에서 받는다.
import { appIdFor } from "@device-farm/core/config/app-config";
import { runScreenQa } from "@device-farm/core/qa/run";
import { execFileText } from "@device-farm/devices/exec";
import { listDevices } from "@device-farm/devices/registry";
import { openDriver } from "@device-farm/server/devices";
import { apiOrigin as apiOriginOf } from "@device-farm/server/env";

import { cliApp } from "./app";

function option(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const app = await cliApp();
  const apiOrigin = apiOriginOf(app);
  if (!apiOrigin) throw new Error("API 주소가 없습니다. farm.config.ts의 apiOrigin이나 FARM_API_ORIGIN을 넣어 주세요.");
  const deviceId = option("device");
  const device = (await listDevices(execFileText, app.appIds.dev, app.iosBundleIds?.dev)).find((item) => item.id === deviceId);
  if (!device) throw new Error(`연결된 기기가 아닙니다: ${deviceId ?? "(--device 없음)"}`);
  const path = option("path");
  const screens = app.qa.screens.filter((screen) => !path || screen.path === path);
  if (screens.length === 0) throw new Error(`QA 규칙이 없는 화면입니다: ${path}`);

  const driver = await openDriver(app, device, appIdFor(app, "dev", device.platform));
  let failed = 0;
  try {
    for (const screen of screens) {
      const report = await runScreenQa(driver, screen, { apiOrigin });
      console.log(`\n${report.name} (${report.path})`);
      for (const api of report.apis) console.log(`  API ${api.status} ${api.durationMs}ms ${api.path}${api.error ? ` · ${api.error}` : ""}`);
      for (const check of report.checks) console.log(`  ${check.ok ? "통과" : "실패"} ${check.title}${check.message ? ` — ${check.message}` : ""}`);
      failed += report.checks.filter((check) => !check.ok).length;
    }
  } finally {
    await driver.close();
  }
  process.exitCode = failed > 0 ? 1 : 0;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

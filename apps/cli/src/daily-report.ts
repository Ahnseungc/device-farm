// 아침 분석을 지금 돌린다: npm run daily-report -- [--day 2026-11-13] [--slack]
// --slack 없이 돌리면 저장만 하고 슬랙 글을 콘솔에 낸다(확인용). 같은 날 다시 돌리면 덮어쓰고 슬랙 글은 고친다.
import { dailySlackText, dayTitle, localDay } from "@device-farm/core/report/daily";
import { runDailyReport } from "@device-farm/server/daily-report";

import { cliApp } from "./app";

function option(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const app = await cliApp();
  const day = option("day") ?? localDay(new Date());
  const report = await runDailyReport(day, { appName: app.name, send: process.argv.includes("--slack"), log: (message) => console.log(message) });
  console.log(`\n${dailySlackText(report.input, report.analysis, dayTitle(new Date(`${day}T00:00:00`)), report.failure)}`);
  if (report.ts) console.log(`\n슬랙 ${report.channel} ${report.ts}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

// 옛 test-results/ JSON 기록을 farm.db로 옮긴다: npm run db-import [-- --root test-results]
// 이미 DB에 있는 것은 건너뛰어 다시 돌려도 겹치지 않는다. 옛 파일은 지우지 않는다.
import path from "node:path";

import { farmDb, farmDbFile } from "@device-farm/engine/db/farm-db";
import { importLegacyResults } from "@device-farm/engine/db/import";

function option(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function main(): void {
  const root = path.resolve(option("root") ?? "test-results");
  const { skipped, ...counts } = importLegacyResults(root, farmDb());
  console.log(`${root} → ${farmDbFile}`);
  for (const [name, count] of Object.entries(counts)) console.log(`  ${name}: ${count}`);
  for (const line of skipped) console.warn(`  건너뜀 ${line}`);
}

try {
  main();
} catch (error) {
  console.error(`가져오기 실패: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}

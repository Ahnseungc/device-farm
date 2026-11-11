// `npx device-farm init`: 작업 폴더에 farm.config.ts·.env.example을 만든다. 이미 있는 파일은 덮지 않는다.
import { copyFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** 번들된 bin 옆 `templates/` → 사용자 프로젝트 파일 이름 */
const templates = [
  { from: "farm.config.ts", to: "farm.config.ts" },
  { from: "env.example", to: ".env.example" },
] as const;

export function init(cwd = process.cwd()): void {
  const dir = fileURLToPath(new URL("./templates", import.meta.url));
  for (const template of templates) {
    const target = path.join(cwd, template.to);
    if (existsSync(target)) {
      console.log(`건너뜀  ${template.to} (이미 있습니다)`);
      continue;
    }
    copyFileSync(path.join(dir, template.from), target);
    console.log(`만듦    ${template.to}`);
  }
  console.log(`
다음 단계
  1. farm.config.ts를 내 앱 값(appIds·web·homePath·tabPaths…)으로 바꿉니다.
  2. 비밀 값이 필요하면 .env.example을 .env로 복사해 채웁니다.
  3. .gitignore에 .env·test-results/를 넣습니다.
  4. npx device-farm dev 로 화면을 엽니다.`);
}

// npm 빌드 마지막 단계: `device-farm init`이 복사할 템플릿을 dist/templates에 만든다.
// farm.config.example.ts의 워크스페이스 import를 패키지 이름 하나로 바꾼다.
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const out = path.join(root, "dist/templates");
const packageName = "@ahnseungchan/device-farm";

const header = `/**
 * 디바이스팜 앱 설정(\`npx device-farm init\`이 만든 예시: 가상의 쇼핑 앱 「Sample Shop」).
 * 값을 내 앱으로 바꾼다. 필수는 name·appIds·homePath·homeTabName·tabPaths뿐이고 나머지는 지워도 된다.
 * 비밀 값(토큰·키)은 여기 말고 .env에 둔다.
 */
import { defineAppConfig, equalWon, formatWon, numberAt, textHas } from "${packageName}";
`;

const example = readFileSync(path.join(root, "farm.config.example.ts"), "utf8");
const body = example.slice(example.indexOf("\nexport default") + 1);
assert.ok(body.startsWith("export default defineAppConfig("), "farm.config.example.ts 모양이 바뀌었습니다.");
const config = `${header}\n${body}`;
assert.ok(!config.includes("@device-farm/"), "템플릿에 워크스페이스 import가 남았습니다.");

mkdirSync(out, { recursive: true });
writeFileSync(path.join(out, "farm.config.ts"), config);
copyFileSync(path.join(root, ".env.example"), path.join(out, "env.example"));
console.log(`templates → ${path.relative(root, out)}`);

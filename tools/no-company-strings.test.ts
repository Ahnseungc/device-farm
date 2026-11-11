// 회사·특정 앱 흔적 검사: 저장소 파일에 금지 문자열이 남아 있으면 실패한다.
// 앱마다 다른 값은 farm.config.ts(커밋하지 않는다)에만 둔다.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const skippedDirs = new Set(["node_modules", ".git", "test-results"]);
/** 사용자가 만드는 로컬 파일. 저장소에 올라가지 않는다 */
const skippedFiles = new Set(["farm.config.ts", ".env"]);
const thisFile = path.relative(root, new URL(import.meta.url).pathname);

/** 대소문자 무시. 이 파일 자신은 목록 때문에 건너뛴다 */
const denylist = ["goldie", "골디", "goldn", "goldncompany", "금고", "EH0KGqF7", "nb3vl6A5", "HA36RNHN6C", "73b07d6c", "dev-internal"];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return skippedDirs.has(name) ? [] : files(full);
    return skippedFiles.has(name) ? [] : [full];
  });
}

const problems: string[] = [];
for (const file of files(root)) {
  const relative = path.relative(root, file);
  if (relative === thisFile) continue;
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, index) => {
    const lower = line.toLowerCase();
    for (const word of denylist) if (lower.includes(word.toLowerCase())) problems.push(`${relative}:${index + 1}: ${word}`);
  });
  for (const word of denylist) if (relative.toLowerCase().includes(word.toLowerCase())) problems.push(`${relative}: 파일 이름에 ${word}`);
}

assert.deepEqual(problems, [], `금지 문자열이 남아 있습니다:\n${problems.join("\n")}`);
console.log("no-company-strings ok");

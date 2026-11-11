// 패키지 의존 방향 검사: core ← devices ← engine ← server ← apps.
// core는 node·외부 패키지 없이 순수 로직만 둔다(테스트 파일은 node:assert 등 node 모듈만 허용).
// 화면(apps/web)은 core만 쓴다. server는 vite 플러그인 설정(vite.config.ts)에서만 가져온다.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

/** 각 위치가 가져와도 되는 워크스페이스 패키지 */
const allowed: Record<string, readonly string[]> = {
  "packages/core": [],
  "packages/devices": ["core"],
  "packages/engine": ["core", "devices"],
  "packages/server": ["core", "devices", "engine"],
  "apps/cli": ["core", "devices", "engine", "server"],
  "apps/mcp": ["core", "devices", "engine", "server"],
  "apps/web": ["core"],
};
/** 예외: vite 플러그인으로 서버 API를 붙이는 설정 파일 */
const webServerEntry = "apps/web/vite.config.ts";

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (name === "node_modules") return [];
    if (statSync(full).isDirectory()) return sources(full);
    return /\.tsx?$/.test(name) ? [full] : [];
  });
}

const importPattern = /(?:from\s+|import\s*\(\s*|import\s+)"([^"]+)"/g;
const problems: string[] = [];

for (const [area, packages] of Object.entries(allowed)) {
  for (const file of sources(path.join(root, area))) {
    const relative = path.relative(root, file);
    const isTest = file.endsWith(".test.ts");
    for (const [, spec] of readFileSync(file, "utf8").matchAll(importPattern)) {
      if (spec.startsWith(".")) continue;
      const workspace = /^@device-farm\/([^/]+)/.exec(spec)?.[1];
      if (workspace) {
        const ok = packages.includes(workspace) || (relative === webServerEntry && workspace === "server");
        if (!ok) problems.push(`${relative}: ${spec}`);
        continue;
      }
      // core 소스는 node·외부 패키지를 쓰지 않는다. 테스트는 node 모듈만 쓴다.
      if (area === "packages/core" && !(isTest && spec.startsWith("node:"))) problems.push(`${relative}: ${spec}`);
    }
  }
}

assert.deepEqual(problems, [], `의존 방향을 어긴 import:\n${problems.join("\n")}`);
console.log("boundaries ok");

import { defineConfig } from "tsup";

// npm 패키지 빌드: 워크스페이스(@device-farm/*)는 묶고, package.json dependencies(playwright·vite·tsx…)는 밖에 둔다.
export default defineConfig({
  entry: { index: "packages/core/src/index.ts", bin: "apps/cli/src/bin.ts" },
  format: ["esm"],
  platform: "node",
  target: "node22",
  outDir: "dist",
  splitting: true,
  noExternal: [/^@device-farm\//],
  dts: { entry: { index: "packages/core/src/index.ts" } },
});

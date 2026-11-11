// 데모 빌드: 서버·기기 없이 가짜 데이터로 화면만 띄운다(GitHub Pages). 실제 빌드(apps/web/vite.config.ts)와 따로 돈다.
// `./api-client`·`./live-view` import만 demo/ 쪽 모듈로 바꿔 끼우고 나머지 화면 코드는 그대로 쓴다.
import path from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const demoDir = fileURLToPath(new URL(".", import.meta.url));
const webRoot = path.resolve(demoDir, "..");
const repoRoot = path.resolve(webRoot, "../..");
/** 로컬 미리 보기 포트. 실제 화면 기본 포트(5173)와 겹치지 않게 둔다 */
const previewPort = 5499;

const swaps: Record<string, string> = {
  "./api-client": path.join(demoDir, "api-client.ts"),
  "./live-view": path.join(demoDir, "live-view.tsx"),
};

function demoSwap(): Plugin {
  return {
    name: "device-farm-demo-swap",
    enforce: "pre",
    resolveId(source, importer) {
      if (!importer || importer.startsWith(demoDir)) return null;
      if (!importer.startsWith(webRoot)) return null;
      return swaps[source] ?? null;
    },
  };
}

export default defineConfig({
  root: webRoot,
  // Pages 주소는 /device-farm/. 로컬은 `/`
  base: process.env.DEMO_BASE ?? "/",
  plugins: [demoSwap(), react()],
  build: { outDir: path.join(repoRoot, "demo-dist"), emptyOutDir: true },
  preview: { host: "127.0.0.1", port: previewPort, strictPort: true },
  server: { host: "127.0.0.1", port: previewPort, strictPort: true },
});

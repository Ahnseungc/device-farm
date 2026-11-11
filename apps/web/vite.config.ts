import path from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import { loadAppConfig, resolveAppConfigFile } from "@device-farm/server/app-config";
import { devicePlugin } from "@device-farm/server/http/device-api";

const repoRoot = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");
/** 화면 서버 포트. 기본 5173, `FARM_PORT`로 바꾼다 */
const defaultPort = 5173;

// 앱 설정은 `FARM_CONFIG` → 이 저장소 루트의 farm.config.ts → farm.config.example.ts 순으로 찾는다.
// 설정 함수(async)는 Vite 모듈 러너가 닫힌 뒤에 불려 동적 import가 실패한다. 최상위에서 먼저 읽는다.
const app = await loadAppConfig(resolveAppConfigFile(process.env, repoRoot));

// 디바이스팜은 127.0.0.1에만 연다. 밖에서는 `tailscale serve --bg <포트>`로만 들어온다(docs/operations.md).
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react(), devicePlugin({ app })],
  server: {
    host: "127.0.0.1",
    port: Number(process.env.FARM_PORT) || defaultPort,
    strictPort: true,
    // serve로 들어오면 Host가 `<맥>.<tailnet>.ts.net`이다. Vite는 기본으로 localhost 외 Host를 403으로 막는다
    // (DNS rebinding 방어). tailnet 이름만 열고 나머지는 계속 막는다.
    allowedHosts: [".ts.net"],
  },
});

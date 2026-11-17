import path from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import { loadAppConfig, resolveAppConfigFile } from "@device-farm/server/app-config";
import { loadDotEnv } from "@device-farm/server/env";
import { devicePlugin } from "@device-farm/server/http/device-api";
import { http1OnlyPlugin, listenOptions } from "@device-farm/server/http/lan";

const repoRoot = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");
/** 화면 서버 포트. 기본 5173, `FARM_PORT`로 바꾼다 */
const defaultPort = 5173;

// 앱 설정은 `FARM_CONFIG` → 이 저장소 루트의 farm.config.ts → farm.config.example.ts 순으로 찾는다.
// 설정 함수(async)는 Vite 모듈 러너가 닫힌 뒤에 불려 동적 import가 실패한다. 최상위에서 먼저 읽는다.
loadDotEnv(path.join(repoRoot, ".env"));
const app = await loadAppConfig(resolveAppConfigFile(process.env, repoRoot));

const listen = listenOptions(Number(process.env.FARM_PORT) || defaultPort);
const lan = Boolean(listen.https);

// 기본은 127.0.0.1에만 연다. 밖에서는 `tailscale serve --bg <포트>`(docs/operations.md).
// 사내망 모드(.env의 FARM_TLS_* 등)면 HTTPS로 열고, 모든 요청이 devicePlugin의 팀 비밀번호 관문을 지난다.
// Vite WebSocket(HMR)은 관문보다 먼저 붙으므로 그때는 끈다.
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react(), devicePlugin({ app }), ...(lan ? [http1OnlyPlugin()] : [])],
  server: lan ? { ...listen, hmr: false, ws: false } : listen,
});

// `npx device-farm dev`: 패키지에 미리 빌드해 둔 화면(dist/web)을 vite preview로 열고 기기 API를 붙인다.
// 저장소에서 화면을 고칠 때는 `npm run dev`(vite dev)를 쓴다.
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { preview } from "vite";

import { devicePlugin } from "@device-farm/server/http/device-api";
import { http1OnlyPlugin, listenOptions } from "@device-farm/server/http/lan";

import { cliApp } from "./app";

/** 번들된 bin 옆 `web/`(dist/web) */
const webDist = fileURLToPath(new URL("./web", import.meta.url));

export async function serve(port: number): Promise<void> {
  if (!existsSync(path.join(webDist, "index.html"))) throw new Error(`화면 빌드가 없습니다: ${webDist} (저장소에서는 npm run build 또는 npm run dev)`);
  const app = await cliApp();
  // 기본은 127.0.0.1에만 연다(밖에서는 `tailscale serve --bg <포트>`). TLS·팀 비밀번호를 .env에 두면 사내망에 HTTPS로 연다
  const listen = listenOptions(port);
  const server = await preview({
    configFile: false,
    // root를 web 바로 위(dist)로 둬야 vite가 outDir=root 경고를 내지 않는다
    root: path.dirname(webDist),
    build: { outDir: webDist },
    preview: listen,
    plugins: [devicePlugin({ app }), ...(listen.https ? [http1OnlyPlugin()] : [])],
  });
  server.printUrls();
  const close = () => {
    server.close().finally(() => process.exit(0));
  };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
}

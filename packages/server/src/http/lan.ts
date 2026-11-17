import { readFileSync } from "node:fs";

import type { Plugin } from "vite";

import { normalizeOrigin } from "../auth/access";

/**
 * 사내망 모드(선택): `.env`에 `FARM_TLS_CERT`·`FARM_TLS_KEY`·`FARM_PUBLIC_ORIGIN`·`FARM_PASSWORD_HASH`가 다 있으면
 * 같은 망의 다른 PC가 HTTPS + 팀 비밀번호 로그인으로 들어온다. 하나도 없으면 지금처럼 127.0.0.1에만 http로 연다
 * (밖에서는 `tailscale serve`). 일부만 있으면 무엇이 빠졌는지 알려 주고 throw.
 */
export interface ListenOptions {
  host: string;
  port: number;
  strictPort: true;
  https?: { cert: Buffer; key: Buffer };
  allowedHosts: string[];
}

const lanEnvKeys = ["FARM_TLS_CERT", "FARM_TLS_KEY", "FARM_PUBLIC_ORIGIN", "FARM_PASSWORD_HASH"] as const;

/** 로컬 모드에서 여는 Host. `tailscale serve`로 들어오면 `<맥>.<tailnet>.ts.net`이다 */
const localAllowedHosts = [".ts.net"];

export function listenOptions(port: number, env: NodeJS.ProcessEnv = process.env): ListenOptions {
  const values = Object.fromEntries(lanEnvKeys.map((key) => [key, env[key]?.trim() || undefined])) as Record<(typeof lanEnvKeys)[number], string | undefined>;
  const present = lanEnvKeys.filter((key) => values[key]);
  // 비밀번호만 있으면 로컬 모드 그대로(관문은 비밀번호 세션). TLS 쪽이 하나라도 있으면 사내망 모드를 켜려는 것이다
  const wantsLan = Boolean(values.FARM_TLS_CERT || values.FARM_TLS_KEY);
  if (!wantsLan) return { host: "127.0.0.1", port, strictPort: true, allowedHosts: localAllowedHosts };
  const missing = lanEnvKeys.filter((key) => !present.includes(key));
  if (missing.length > 0) throw new Error(`[farm] 사내망 모드에는 ${missing.join("·")}도 필요합니다(.env).`);
  const publicOrigin = normalizeOrigin(values.FARM_PUBLIC_ORIGIN);
  if (!publicOrigin) throw new Error("[farm] FARM_PUBLIC_ORIGIN이 주소가 아닙니다. 예: https://farm-host.local:5173");
  return {
    // IPv4·IPv6 둘 다. mDNS 이름이 IPv6 링크 로컬 주소로도 알려져 IPv4만 열면 다른 PC가 거기서 멈춘다
    host: "::",
    port,
    strictPort: true,
    https: { cert: readFileSync(values.FARM_TLS_CERT ?? ""), key: readFileSync(values.FARM_TLS_KEY ?? "") },
    // DNS rebinding 방어: 정한 이름만 연다
    allowedHosts: [new URL(publicOrigin).hostname, "localhost", "127.0.0.1"],
  };
}

/**
 * Vite 7은 HTTPS면 HTTP/2 서버(allowHTTP1)를 만든다. 브라우저가 h2로 붙으면 WebSocket(기기 스트림)이
 * HTTP/2 확장 CONNECT를 요구해 연결되지 않는다(ws는 HTTP/1.1 업그레이드만 받는다). TLS가 HTTP/1.1만 제안하게 바꾼다.
 */
export function http1OnlyPlugin(): Plugin {
  const http11 = Buffer.from([8, ...Buffer.from("http/1.1")]);
  const apply = (httpServer: unknown) => {
    const tls = httpServer as { ALPNProtocols?: Buffer } | null;
    if (!tls || !("ALPNProtocols" in tls)) {
      console.warn("[farm] HTTPS 서버의 ALPN을 바꾸지 못했습니다. 브라우저 기기 스트림이 끊길 수 있습니다.");
      return;
    }
    tls.ALPNProtocols = http11;
  };
  return {
    name: "device-farm-http1-only",
    configureServer: (server) => apply(server.httpServer),
    configurePreviewServer: (server) => apply(server.httpServer),
  };
}

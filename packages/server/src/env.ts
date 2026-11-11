import { existsSync } from "node:fs";
import path from "node:path";

import type { AppConfig } from "@device-farm/core/config/app-config";
import type { BuildKind } from "@device-farm/core/device/types";

const webOriginEnv = { dev: "FARM_WEB_ORIGIN_DEV", prod: "FARM_WEB_ORIGIN_PROD" } as const satisfies Record<BuildKind, string>;

/** `.env`가 있으면 읽는다. 이미 있는 환경 변수는 덮지 않는다(node 기본 동작). */
export function loadDotEnv(file = path.resolve(".env")): boolean {
  if (!existsSync(file)) return false;
  process.loadEnvFile(file);
  return true;
}

/** 앱 WebView가 여는 웹 주소. 환경 변수 → 앱 설정 `web` 순. 둘 다 비면 무엇을 채워야 하는지 알려 주고 throw. */
export function webOrigin(app: Pick<AppConfig, "web">, kind: BuildKind): string {
  const name = webOriginEnv[kind];
  const value = process.env[name]?.trim() || app.web[kind];
  if (!value) throw new Error(`${kind} 웹 주소가 없습니다. farm.config.ts의 web.${kind}나 .env의 ${name}에 앱 WebView 웹 주소를 넣어 주세요.`);
  return value.replace(/\/+$/, "");
}

/** API 주소. 환경 변수 `FARM_API_ORIGIN` → 앱 설정 `apiOrigin` 순. 없으면 빈 문자열 */
export function apiOrigin(app: Pick<AppConfig, "apiOrigin">): string {
  return (process.env.FARM_API_ORIGIN?.trim() || app.apiOrigin).replace(/\/+$/, "");
}

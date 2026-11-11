import type { AppConfig } from "@device-farm/core/config/app-config";
import { loadAppConfig } from "@device-farm/server/app-config";
import { loadDotEnv } from "@device-farm/server/env";

/** CLI 시작: `.env`를 읽고 앱 설정(`farm.config.ts`·`FARM_CONFIG`)을 불러온다 */
export async function cliApp(): Promise<AppConfig> {
  loadDotEnv();
  return loadAppConfig();
}

/** 디바이스팜 화면 서버 포트(`FARM_PORT`, 기본 5173) */
export const farmPort = () => Number(process.env.FARM_PORT) || 5173;

import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { defineAppConfig, isFarmLocale, type AppConfig, type AppConfigInput } from "@device-farm/core/config/app-config";

/**
 * 앱 설정 파일 읽기. 서버·CLI·MCP가 시작할 때 한 번 부르고, 받은 값을 인자로 넘긴다.
 * 찾는 순서: `FARM_CONFIG` → `<cwd>/farm.config.ts` → `<cwd>/farm.config.example.ts`(예시 앱, 경고를 남긴다).
 */
export const appConfigFileNames = ["farm.config.ts", "farm.config.example.ts"] as const;

export function resolveAppConfigFile(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): string {
  const fromEnv = env.FARM_CONFIG?.trim();
  if (fromEnv) {
    const file = path.resolve(cwd, fromEnv);
    if (!existsSync(file)) throw new Error(`FARM_CONFIG 파일이 없습니다: ${file}`);
    return file;
  }
  const found = appConfigFileNames.map((name) => path.join(cwd, name)).find((file) => existsSync(file));
  if (!found) throw new Error(`앱 설정이 없습니다. ${cwd}에 farm.config.ts를 만들거나 FARM_CONFIG로 경로를 알려 주세요(farm.config.example.ts 참고).`);
  return found;
}

function isInput(value: unknown): value is AppConfigInput {
  if (!value || typeof value !== "object") return false;
  const config = value as Partial<AppConfigInput>;
  return typeof config.name === "string" && typeof config.appIds?.dev === "string" && typeof config.homePath === "string" && typeof config.homeTabName === "string";
}

/** 이미 `defineAppConfig()`를 거친 값인지(기본 금지어가 채워져 있다) */
const isDefined = (value: AppConfigInput | AppConfig): value is AppConfig => Array.isArray((value as AppConfig).guard?.forbiddenButtonWords);

/**
 * 설정 값을 앱 설정으로. `defineAppConfig({...})` 결과든, 그냥 객체(`{...} satisfies AppConfigInput`)든 받는다.
 * 사용자 프로젝트에서는 `@device-farm/core`를 못 불러올 수 있어 그냥 객체도 받는다(`import type`은 실행 때 지워진다).
 */
export function normalizeAppConfig(value: unknown, source = "앱 설정"): AppConfig {
  if (!isInput(value)) throw new Error(`${source}의 default export가 앱 설정이 아닙니다. name·appIds·homePath·homeTabName·tabPaths가 있어야 합니다.`);
  return isDefined(value) ? value : defineAppConfig(value);
}

/** `FARM_LOCALE`(ko·en)이 있으면 설정 파일의 `locale`보다 먼저 쓴다. 모르는 값은 무시한다 */
export function withLocaleEnv(config: AppConfig, env: NodeJS.ProcessEnv = process.env): AppConfig {
  const fromEnv = env.FARM_LOCALE?.trim().toLowerCase();
  return isFarmLocale(fromEnv) ? { ...config, locale: fromEnv } : config;
}

export async function loadAppConfig(file = resolveAppConfigFile(), log: (line: string) => void = console.log, env: NodeJS.ProcessEnv = process.env): Promise<AppConfig> {
  const loaded = (await import(/* @vite-ignore */ pathToFileURL(file).href)) as { default?: unknown };
  const config = withLocaleEnv(normalizeAppConfig(loaded.default, file), env);
  if (path.basename(file) === "farm.config.example.ts") log(`[farm] farm.config.ts가 없어 예시 앱 설정(${file})으로 시작합니다.`);
  return config;
}

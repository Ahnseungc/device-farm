import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { sampleApp } from "@device-farm/core/config/sample-app";

import { loadAppConfig, normalizeAppConfig, resolveAppConfigFile, withLocaleEnv } from "./app-config-file";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");
const example = path.join(repoRoot, "farm.config.example.ts");

// 저장소 루트에 farm.config.ts가 없으면 예시로 시작한다(경고를 남긴다)
{
  const logs: string[] = [];
  const app = await loadAppConfig(example, (line) => logs.push(line));
  assert.equal(app.name, "Sample Shop");
  assert.equal(app.tabPaths[app.homeTabName], "/home");
  assert.ok(app.guard.forbiddenButtonWords.includes("결제"), "기본 금지어가 들어 있다");
  assert.ok(app.guard.forbiddenButtonWords.includes("쿠폰 사용"), "앱 금지어가 더해진다");
  assert.equal(logs.length, 1);
}

// 찾는 순서: FARM_CONFIG → farm.config.ts → farm.config.example.ts
const dir = mkdtempSync(path.join(tmpdir(), "farm-config-"));
try {
  assert.throws(() => resolveAppConfigFile({}, dir), /앱 설정이 없습니다/);
  writeFileSync(path.join(dir, "farm.config.example.ts"), "export default {};\n");
  assert.equal(resolveAppConfigFile({}, dir), path.join(dir, "farm.config.example.ts"));
  writeFileSync(path.join(dir, "farm.config.ts"), "export default {};\n");
  assert.equal(resolveAppConfigFile({}, dir), path.join(dir, "farm.config.ts"));
  assert.equal(resolveAppConfigFile({ FARM_CONFIG: example }, dir), example);
  assert.throws(() => resolveAppConfigFile({ FARM_CONFIG: "없는.ts" }, dir), /FARM_CONFIG 파일이 없습니다/);
  await assert.rejects(loadAppConfig(path.join(dir, "farm.config.ts")), /앱 설정이 아닙니다/);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

// defineAppConfig를 거친 값은 그대로, 그냥 객체는 기본값을 채운다
assert.equal(normalizeAppConfig(sampleApp), sampleApp);
const raw = normalizeAppConfig({ name: "Raw", appIds: { dev: "a.dev", prod: "a" }, homePath: "/", homeTabName: "홈", tabPaths: {} });
assert.deepEqual(raw.loginPaths, ["/login"]);
assert.deepEqual(raw.tabPaths, { 홈: "/" });
assert.ok(raw.guard.forbiddenApiPatterns.length > 0);

// 화면 언어: 기본 ko, 설정의 locale, FARM_LOCALE이 이긴다. 모르는 값은 무시
assert.equal(raw.locale, "ko");
assert.equal(normalizeAppConfig({ name: "En", appIds: { dev: "a.dev", prod: "a" }, homePath: "/", homeTabName: "Home", tabPaths: {}, locale: "en" }).locale, "en");
assert.equal(withLocaleEnv(raw, { FARM_LOCALE: "en" }).locale, "en");
assert.equal(withLocaleEnv(raw, { FARM_LOCALE: "fr" }).locale, "ko");
assert.equal(withLocaleEnv(raw, {}), raw);
{
  const app = await loadAppConfig(example, () => undefined, { FARM_LOCALE: "EN" });
  assert.equal(app.locale, "en");
}

console.log("app-config-file ok");

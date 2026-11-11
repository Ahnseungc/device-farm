import assert from "node:assert/strict";

import { appIdFor, defaultForbiddenButtonWords, defineAppConfig, kindOfAppId, publicAppConfig, tabNamesOf } from "./app-config";
import { sampleApp } from "./sample-app";

// 필수만 적어도 나머지는 기본값. 홈 탭은 탭 목록에 들어간다
{
  const app = defineAppConfig({ name: "A", appIds: { dev: "a.dev", prod: "a" }, homePath: "/main", homeTabName: "메인", tabPaths: { 검색: "/search" } });
  assert.deepEqual(app.tabPaths, { 메인: "/main", 검색: "/search" });
  assert.deepEqual(tabNamesOf(app), ["메인", "검색"]);
  assert.deepEqual(app.guard.forbiddenButtonWords, [...defaultForbiddenButtonWords]);
  assert.deepEqual(app.guard.pushTokenRequests, []);
  assert.deepEqual(app.scenarios, []);
  assert.equal(app.deepLink.homeHost, "home");
  assert.equal(app.qa.sessionPath, "/api/auth/session");
  assert.deepEqual(app.access.allowedDomains, []);
}

// 앱 id: iOS 번들 id가 따로 있으면 그것, 모르는 id는 dev
{
  const app = defineAppConfig({ ...sampleApp, iosBundleIds: { prod: "com.example.shop.ios" } });
  assert.equal(appIdFor(app, "prod", "ios"), "com.example.shop.ios");
  assert.equal(appIdFor(app, "dev", "ios"), "com.example.shop.dev");
  assert.equal(appIdFor(app, "prod"), "com.example.shop");
  assert.equal(kindOfAppId(app, "com.example.shop.ios"), "prod");
  assert.equal(kindOfAppId(app, "com.example.shop"), "prod");
  assert.equal(kindOfAppId(app, "other"), "dev");
}

// 화면에 내려 주는 값은 JSON으로 옮길 수 있는 것만
{
  const view = publicAppConfig(sampleApp);
  assert.deepEqual(JSON.parse(JSON.stringify(view)), view);
  assert.equal(view.homeTabName, "홈");
}

console.log("app-config ok");

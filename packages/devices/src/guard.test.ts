import assert from "node:assert/strict";

import type { Page } from "playwright";

import { sampleApp } from "@device-farm/core/config/sample-app";
import { guardAndroidPage, guardTargetOf, isExternal } from "@device-farm/core/explore/guard";
import type { BlockedRequest, GuardHandler, GuardPage, GuardRoute } from "@device-farm/core/explore/guard";

// 실제 Playwright Page가 GuardPage 자리에 들어가는지 타입으로 확인한다.
const acceptsPlaywrightPage = (page: Page): GuardPage => page;
void acceptsPlaywrightPage;

const web = "https://dev.shop.example.com";
const api = "https://api-dev.shop.example.com";

assert.equal(isExternal("https://dev.shop.example.com/home?x=1", web, ""), false);
assert.equal(isExternal("https://pay.example-pg.com/checkout", web, ""), true);
assert.equal(isExternal("https://api-dev.shop.example.com/api/v1/x", web, api), false);
assert.equal(isExternal("https://api-dev.shop.example.com/api/v1/x", web, undefined), true);
assert.equal(isExternal("http://dev.shop.example.com/home", web, ""), true); // 스킴이 다르면 다른 origin
assert.equal(isExternal("intent://scan#Intent;end", web, ""), true);
assert.equal(isExternal("not a url", web, ""), true);

type Outcome = "continue" | `abort:${string}`;

function fakeRoute(method: string, url: string, outcomes: Outcome[]): GuardRoute {
  return {
    request: () => ({ method: () => method, url: () => url }),
    abort: async (code) => void outcomes.push(`abort:${code ?? ""}`),
    continue: async () => void outcomes.push("continue"),
  };
}

const handlers = new Map<string, GuardHandler>();
const page: GuardPage = {
  route: async (url, handler) => void handlers.set(url, handler),
  unroute: async (url, handler) => {
    if (handlers.get(url) === handler) handlers.delete(url);
  },
};

const blocked: BlockedRequest[] = [];
const unroute = await guardAndroidPage(
  page,
  guardTargetOf({ ...sampleApp, apiOrigin: "" }, web),
  { entries: [{ method: "POST", path: "/api/v1/alarm/settings", status: "allow", note: "" }] },
  (request) => blocked.push(request),
);
const routed = handlers.get("**/*");
assert.ok(routed);
const handler: GuardHandler = routed;

async function send(method: string, url: string): Promise<Outcome> {
  const outcomes: Outcome[] = [];
  await handler(fakeRoute(method, url, outcomes));
  assert.equal(outcomes.length, 1);
  return outcomes[0];
}

assert.equal(await send("GET", `${web}/api/v1/orders`), "continue");
assert.equal(await send("POST", `${web}/api/v1/alarm/settings?x=1`), "continue");
assert.equal(await send("POST", `${web}/api/v1/orders`), "abort:blockedbyclient");
assert.equal(await send("post", `${web}/api/v1/unknown`), "abort:blockedbyclient");
assert.equal(await send("POST", "https://sdk.example.com/api/v1/alarm/settings"), "abort:blockedbyclient");
assert.equal(await send("POST", "https://pay.example-pg.com/v2/request"), "abort:blockedbyclient");
assert.deepEqual(
  blocked.map(({ method, path, reason }) => ({ method, path, reason })),
  [
    { method: "POST", path: "/api/v1/orders", reason: "forbidden" },
    { method: "POST", path: "/api/v1/unknown", reason: "unknown" },
    { method: "POST", path: "https://sdk.example.com/api/v1/alarm/settings", reason: "unknown" },
    { method: "POST", path: "https://pay.example-pg.com/v2/request", reason: "forbidden" },
  ],
);
assert.ok(blocked.every((request) => typeof request.at === "number"));

await unroute();
assert.equal(handlers.size, 0);

console.log("guard ok");

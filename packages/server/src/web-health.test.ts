import assert from "node:assert/strict";

import { webHealth } from "./web-health";

const app = { web: { dev: "", prod: "" }, apiOrigin: "" };
process.env.FARM_WEB_ORIGIN_DEV = "https://dev.example/";
delete process.env.FARM_API_ORIGIN;
const answer = (status: number) => (async () => new Response(null, { status })) as typeof fetch;

assert.equal(await webHealth(app, "dev", answer(200)), null);
assert.equal(await webHealth(app, "dev", answer(307)), null);
assert.equal(await webHealth(app, "dev", answer(502)), "HTTP 502");
assert.equal(await webHealth(app, "dev", (async () => Promise.reject(new TypeError("fetch failed"))) as typeof fetch), "접속 실패: fetch failed");
// 주소는 .env 값 그대로(끝 / 없이) 본다
let asked = "";
await webHealth(app, "dev", (async (url: string | URL | Request) => ((asked = String(url)), new Response(null, { status: 200 }))) as typeof fetch);
assert.equal(asked, "https://dev.example");

// dev면 API 서버도 본다. 웹이 정상이어도 API가 멈추면 문제
process.env.FARM_API_ORIGIN = "https://api.example/";
const byHost = (api: number | "hang") =>
  (async (url: string | URL | Request) => {
    if (!String(url).startsWith("https://api.example")) return new Response(null, { status: 307 });
    if (api === "hang") throw Object.assign(new Error("timeout"), { name: "TimeoutError" });
    return new Response(null, { status: api });
  }) as typeof fetch;
assert.equal(await webHealth(app, "dev", byHost(404)), null);
assert.equal(await webHealth(app, "dev", byHost(503)), "API HTTP 503");
assert.equal(await webHealth(app, "dev", byHost("hang")), "API 접속 실패: 10초 안에 응답 없음");
// prod는 API를 보지 않는다
process.env.FARM_WEB_ORIGIN_PROD = "https://prod.example";
assert.equal(await webHealth(app, "prod", byHost("hang")), null);

console.log("web health ok");

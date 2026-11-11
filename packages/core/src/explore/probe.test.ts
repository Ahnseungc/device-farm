import assert from "node:assert/strict";

import { sampleApp } from "../config/sample-app";
import type { ScreenDriver } from "../device/driver";
import { LogRing } from "../logs/ring";
import {
  formatNetworkLog,
  layoutIssues,
  layoutSnapshotScript,
  networkIssue,
  parseNetworkLog,
  probeScreen,
} from "./probe";
import type { LayoutSnapshot } from "./probe";

const clean: LayoutSnapshot = {
  viewportWidth: 390,
  viewportHeight: 844,
  scrollWidth: 390,
  bodyTextLength: 10,
  imageCount: 0,
  offscreen: [],
  bottomFixed: [{ label: "nav", bottom: 810 }],
  safeAreaBottom: 34,
};
const kinds = (snapshot: LayoutSnapshot) => layoutIssues(snapshot).map((issue) => issue.kind);

assert.deepEqual(kinds(clean), []);
assert.deepEqual(kinds({ ...clean, scrollWidth: 400 }), ["overflow"]);
assert.deepEqual(kinds({ ...clean, offscreen: [{ label: "div", left: 0, right: 420 }] }), ["offscreen"]);
assert.equal(kinds({ ...clean, offscreen: Array.from({ length: 25 }, () => ({ label: "x", left: -5, right: 10 })) }).length, 20);
assert.deepEqual(kinds({ ...clean, bodyTextLength: 0 }), ["blank"]);
assert.deepEqual(kinds({ ...clean, bodyTextLength: 0, imageCount: 1 }), []);
assert.deepEqual(kinds({ ...clean, bottomFixed: [{ label: "cta", bottom: 844 }] }), ["bottom-covered"]);

// 허용한 쓰기 409 / 같은 요청 500 / GET 400
const url = "https://dev.shop.example.com/api/v1/alarm/settings";
assert.equal(networkIssue({ method: "POST", status: 409, allowedWrite: true, url }), null);
assert.equal(networkIssue({ method: "POST", status: 500, allowedWrite: true, url })?.kind, "network");
assert.equal(networkIssue({ method: "GET", status: 400, allowedWrite: false, url })?.kind, "network");
assert.equal(networkIssue({ method: "GET", status: 404, allowedWrite: false, url })?.kind, "network");
assert.equal(networkIssue({ method: "POST", status: 403, allowedWrite: true, url })?.kind, "network");
assert.equal(networkIssue({ method: "GET", status: 302, allowedWrite: false, url }), null);
assert.equal(networkIssue({ method: "POST", status: 0, allowedWrite: false, url }), null); // 가드가 막은 요청

assert.equal(formatNetworkLog("post", 409, url), `POST 409 ${url}`);
assert.deepEqual(parseNetworkLog(formatNetworkLog("post", 409, url)), { method: "POST", status: 409, url });
assert.equal(parseNetworkLog("garbage"), null);

// 브라우저 식이 문법상 맞는지만 본다(DOM 없이 실행하지 않음)
assert.doesNotThrow(() => new Function(`return ${layoutSnapshotScript};`));

function fakeDriver(path: string, text: string, snapshot: LayoutSnapshot): ScreenDriver {
  const fail = async (): Promise<never> => {
    throw new Error("not used");
  };
  return {
    app: sampleApp,
    navigate: fail,
    clickButton: fail,
    expectText: fail,
    screenshot: fail,
    close: async () => undefined,
    currentPath: async () => path,
    hasText: async (needle) => text.includes(needle),
    evaluate: async <T>(script: string) => {
      assert.equal(script, layoutSnapshotScript);
      return snapshot as T;
    },
  };
}

let clock = 1_000;
const ring = new LogRing(30_000, () => clock);
ring.push({ source: "console", text: "old error" });
clock = 2_000;
ring.push({ source: "console", text: "TypeError: x" });
ring.push({ source: "crash", text: "FATAL EXCEPTION" });
ring.push({ source: "system", text: "noise" });
ring.push({ source: "network", text: formatNetworkLog("POST", 409, url) });
ring.push({ source: "network", text: formatNetworkLog("POST", 422, "https://dev.shop.example.com/api/v1/other") });
ring.push({ source: "network", text: formatNetworkLog("GET", 500, url) });

const allowlist = { entries: [{ method: "POST" as const, path: "/api/v1/alarm/settings", status: "allow" as const, note: "" }] };
const issues = await probeScreen(fakeDriver("/login", "Application error", { ...clean, scrollWidth: 999 }), ring, 2_000, allowlist);
assert.deepEqual(
  issues.map((issue) => issue.kind),
  ["login-redirect", "app-error", "overflow", "console", "crash", "network", "network"],
);
assert.equal(issues.some((issue) => issue.message === "old error"), false);
assert.equal(issues.some((issue) => issue.message.includes("409")), false);

// 허용 목록 없이 보면 허용한 쓰기가 없으므로 409도 오류
const strict = await probeScreen(fakeDriver("/home", "", clean), ring, 2_000);
assert.equal(strict.filter((issue) => issue.kind === "network").length, 3);

console.log("probe ok");

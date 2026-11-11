import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { ScreenDriver } from "@device-farm/core/device/driver";
import { DeviceLocks } from "@device-farm/core/device/lock";
import type { Device } from "@device-farm/core/device/types";
import type { ExplorePath, ExploreRun } from "@device-farm/core/explore/actions";
import type { Issue } from "@device-farm/core/explore/probe";

import { humanControlMessage } from "../run";
import type { CrawlInput } from "./crawler";
import { readLatestExplore } from "./results";
import { devOnlyMessage, ExploreRequestError, iosCleanOnlyMessage, noAndroidMessage, replayOne, runExplore, type ExploreDeps } from "./run";
import { sampleApp } from "@device-farm/core/config/sample-app";

const root = mkdtempSync(path.join(tmpdir(), "explore-run-"));

function device(id: string, platform: Device["platform"], appVersion: string | null = "2.1.5"): Device {
  return { id, platform, model: `model-${id}`, osVersion: "14", appVersion };
}

const driver: ScreenDriver = {
  app: sampleApp,
  navigate: async () => {},
  clickButton: async () => {},
  expectText: async () => {},
  currentPath: async () => "/",
  hasText: async () => false,
  screenshot: async () => Buffer.from("png"),
  evaluate: async <T>() => "https://dev.shop.example.test/" as T,
  close: async () => {},
};

const cleanPath: ExplorePath = { id: "p-clean", actions: [{ kind: "click", role: "button", name: "알림" }] };
const blockedPath: ExplorePath = { id: "p-blocked", actions: [{ kind: "click", role: "button", name: "저장" }] };

/** 가짜 crawl: 두 경로를 돌고 p-clean에서 오류 하나. p-blocked는 차단돼 깨끗하지 않다. */
async function fakeCrawl(input: CrawlInput): Promise<ExploreRun> {
  const run: ExploreRun = {
    runId: input.runId ?? "",
    deviceId: input.deviceId ?? "",
    startedAt: new Date(0).toISOString(),
    finishedAt: null,
    paths: [],
    issues: [],
    blocked: [],
    cleanPathIds: [],
    replayFailures: [],
  };
  const issues = await input.probe();
  run.paths.push(cleanPath, blockedPath);
  run.issues.push(...issues.map((issue) => ({ ...issue, pathId: cleanPath.id, screenshot: "", logDir: "" })));
  run.cleanPathIds.push(cleanPath.id);
  run.blocked.push({ method: "POST", path: "/api/save", reason: "unknown", at: 0, pathId: blockedPath.id });
  run.finishedAt = new Date(1).toISOString();
  input.onStep(run);
  return run;
}

function deps(devices: Device[], overrides: Partial<ExploreDeps> = {}): ExploreDeps & { replayed: string[]; guarded: string[]; bundles: string[] } {
  const replayed: string[] = [];
  const guarded: string[] = [];
  const bundles: string[] = [];
  return {
    replayed,
    guarded,
    bundles,
    app: sampleApp,
    locks: new DeviceLocks(),
    listDevices: async () => devices,
    openDriver: async () => driver,
    allowlist: { entries: [] },
    formValues: {},
    webOrigin: "https://dev.shop.example.test",
    resultsRoot: root,
    now: () => 1_000,
    writeBundle: async (dir) => {
      bundles.push(path.relative(root, dir));
    },
    guard: async (_driver, _origin, _allowlist, _onBlocked) => {
      guarded.push("on");
      return async () => {};
    },
    crawl: fakeCrawl,
    replay: async (_driver, item) => {
      replayed.push(item.id);
    },
    probe: async (): Promise<Issue[]> => [{ kind: "console", message: "boom" }],
    log: () => {},
    ...overrides,
  };
}

{
  const fake = deps([device("A", "android"), device("I", "ios")]);
  const results = await runExplore({ deviceIds: "all", runId: "run-1" }, fake);
  const android = results.find((result) => result.deviceId === "A");
  const ios = results.find((result) => result.deviceId === "I");
  assert.ok(android && ios);
  assert.deepEqual(fake.guarded, ["on"]);
  assert.deepEqual(fake.replayed, ["p-clean"], "iOS는 cleanPathIds 밖 경로를 돌지 않는다");
  assert.equal(android.issues[0].screenshot, "explore/run-1/A/screen-1/screenshot.png");
  assert.equal(android.issues[0].logDir, "explore/run-1/A/screen-1");
  assert.equal(ios.issues[0].logDir, "explore/run-1/I/screen-1");
  assert.ok(android.finishedAt && ios.finishedAt);
  assert.equal(fake.locks.ownerOf("A"), null);
  assert.equal(fake.locks.ownerOf("I"), null);
  assert.deepEqual(readLatestExplore(root).map((result) => result.deviceId).sort(), ["A", "I"]);

  const issues = await replayOne("A", "run-1", "p-blocked", fake);
  assert.deepEqual(issues, [{ kind: "console", message: "boom" }]);
  await assert.rejects(replayOne("I", "run-1", "p-blocked", fake), (error: unknown) => error instanceof ExploreRequestError && error.status === 400 && error.message === iosCleanOnlyMessage);
  await assert.rejects(replayOne("A", "run-1", "nope", fake), (error: unknown) => error instanceof ExploreRequestError && error.status === 404);
  fake.locks.acquire("A", { kind: "user", user: "local" });
  await assert.rejects(replayOne("A", "run-1", "p-clean", fake), (error: unknown) => error instanceof ExploreRequestError && error.status === 409);
}

{
  const fake = deps([device("P", "android", null), device("I", "ios")]);
  const results = await runExplore({ deviceIds: "all" }, fake);
  assert.equal(results.find((result) => result.deviceId === "P")?.message, devOnlyMessage);
  assert.equal(results.find((result) => result.deviceId === "I")?.message, noAndroidMessage);
  assert.deepEqual(fake.replayed, []);
  assert.deepEqual(fake.guarded, []);
}

{
  const fake = deps([device("I", "ios")]);
  const [result] = await runExplore({ deviceIds: ["I"] }, fake);
  assert.equal(result.message, noAndroidMessage);
  assert.ok(result.finishedAt);
}

{
  const fake = deps([device("A", "android")]);
  fake.locks.acquire("A", { kind: "user", user: "local" });
  const [result] = await runExplore({ deviceIds: "all" }, fake);
  assert.equal(result.message, humanControlMessage);
  assert.deepEqual(fake.locks.ownerOf("A"), { kind: "user", user: "local" });
}

{
  const fake = deps([device("A", "android")], { guard: async () => { throw new Error("guard failed"); } });
  const [result] = await runExplore({ deviceIds: "all" }, fake);
  assert.equal(result.message, "guard failed");
  assert.equal(fake.locks.ownerOf("A"), null);
}

rmSync(root, { recursive: true, force: true });
console.log("explore-run ok");

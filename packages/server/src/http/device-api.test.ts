import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";

import { sampleApp } from "@device-farm/core/config/sample-app";
import type { InputEvent } from "@device-farm/core/device/input";
import { DeviceLocks } from "@device-farm/core/device/lock";
import type { Device } from "@device-farm/core/device/types";
import { iosBackUnsupported } from "@device-farm/devices/stream/ios";

import { createJobGate } from "../jobs";
import type { Farm } from "../types";
import { botLockMessage, deviceMiddleware, noLockMessage, prodExploreMessage, streamIdOf } from "./device-api";

const scratch = mkdtempSync(path.join(tmpdir(), "device-api-"));
const resultsRoot = path.join(scratch, "test-results");
mkdirSync(path.join(resultsRoot, "devices/run-1/A/s1"), { recursive: true });
writeFileSync(path.join(resultsRoot, "devices/run-1/A/s1/screenshot.png"), "png");
writeFileSync(path.join(resultsRoot, "devices/run-1/A/s1/notes.txt"), "txt");
writeFileSync(path.join(scratch, "secret.png"), "secret");
symlinkSync(path.join(scratch, "secret.png"), path.join(resultsRoot, "devices/link.png"));

const devices: Device[] = [
  { id: "A", platform: "android", model: "Galaxy", osVersion: "14", appVersion: "2.1.5" },
  { id: "I", platform: "ios", model: "iPhone", osVersion: "18", appVersion: "2.1.5" },
];

/** 진짜 작업 게이트에 가짜 runDevices. 첫 실행은 release를 부를 때까지 끝나지 않는다. */
function fakeFarm() {
  const gate = createJobGate(() => {});
  const calls = { runDevices: 0, explore: 0, inputs: [] as InputEvent[] };
  let release = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const locks = new DeviceLocks();
  const farm: Farm = {
    app: sampleApp,
    resultsRoot,
    locks,
    mjpegUrl: "http://127.0.0.1:9",
    isBusy: gate.isBusy,
    listDevices: async () => devices.map((device) => ({ ...device, state: "idle" as const })),
    platformOf: async (id) => devices.find((device) => device.id === id)?.platform ?? null,
    startRun: () => {
      const started = gate.start("run", async () => {
        calls.runDevices += 1;
        for (const device of devices) locks.acquire(device.id, { kind: "bot", runId: "run-1" });
        await pending;
      });
      return started ? { ok: true, runId: "run-1" } : { ok: false, error: gate.busyMessage() };
    },
    stopRun: () => gate.isBusy(),
    latestRun: () => null,
    pendingBaselines: () => [],
    candidatePng: () => null,
    confirmBaselines: () => 0,
    startExplore: () => {
      calls.explore += 1;
      if (gate.isBusy()) return { ok: false, error: gate.busyMessage() };
      return { ok: true, runId: "explore-1" };
    },
    latestExplore: () => [],
    replay: async () => [],
    sendInput: async (_id, _platform, event) => {
      calls.inputs.push(event);
    },
    watchVideo: async () => () => {},
    recordControl: () => {},
    policyState: () => null,
    checkPolicy: () => false,
  };
  return { farm, calls, release };
}

interface Reply {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
  json: () => unknown;
}

async function call(farm: Farm, method: string, url: string, body?: unknown, headers: Record<string, string> = {}): Promise<Reply> {
  const req = Object.assign(Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]), { method, url, headers });
  const reply: Reply = { status: 200, headers: {}, body: Buffer.alloc(0), json: () => JSON.parse(reply.body.toString("utf8")) };
  await new Promise<void>((resolve, reject) => {
    const res = {
      headersSent: false,
      set statusCode(value: number) {
        reply.status = value;
      },
      setHeader: (name: string, value: string) => {
        reply.headers[name.toLowerCase()] = value;
      },
      end: (chunk?: string | Buffer) => {
        reply.body = chunk === undefined ? Buffer.alloc(0) : Buffer.from(chunk);
        resolve();
      },
    };
    deviceMiddleware(farm)(req as unknown as IncomingMessage, res as unknown as ServerResponse, () => reject(new Error("next 호출")));
  });
  return reply;
}

const run = { kind: "dev", version: "2.1.5", devices: "all" };

{
  const { farm, calls, release } = fakeFarm();
  const first = await call(farm, "POST", "/api/devices/run", run);
  assert.equal(first.status, 202);
  assert.deepEqual(first.json(), { runId: "run-1" });
  const second = await call(farm, "POST", "/api/devices/run", run);
  assert.equal(second.status, 409);
  assert.deepEqual(second.json(), { error: "이미 기기 점검 중입니다." });
  assert.equal(calls.runDevices, 1);

  const explore = await call(farm, "POST", "/api/devices/explore", { devices: "all", build: "dev" });
  assert.equal(explore.status, 409, "기기 점검 중 탐색 요청");

  const confirm = await call(farm, "POST", "/api/devices/baselines/confirm", {});
  assert.equal(confirm.status, 409);

  const locked = await call(farm, "POST", "/api/devices/A/lock");
  assert.equal(locked.status, 409);
  assert.deepEqual(locked.json(), { error: botLockMessage });

  // 도는 점검은 멈출 수 있다
  const stop = await call(farm, "POST", "/api/devices/run/stop");
  assert.equal(stop.status, 200);
  release();
}

// 멈출 점검이 없으면 409
{
  const { farm } = fakeFarm();
  const stop = await call(farm, "POST", "/api/devices/run/stop");
  assert.equal(stop.status, 409);
  assert.deepEqual(stop.json(), { error: "멈출 점검이 없어요." });
}

{
  // 화면이 쓰는 앱 설정은 정규식 없는 공개 값만
  const { farm } = fakeFarm();
  const app = (await call(farm, "GET", "/api/devices/app")).json() as { name: string; homeTabName: string; tabPaths: Record<string, string> };
  assert.equal(app.name, "Sample Shop");
  assert.equal(app.tabPaths[app.homeTabName], "/home");
  assert.equal("guard" in app, false);
}

{
  const { farm, calls } = fakeFarm();
  const beta = await call(farm, "POST", "/api/devices/run", { ...run, kind: "beta" });
  assert.equal(beta.status, 400);
  assert.ok(typeof (beta.json() as { error: unknown }).error === "string");
  assert.equal((await call(farm, "POST", "/api/devices/run", { ...run, devices: [] })).status, 400);
  assert.equal(calls.runDevices, 0);
}

{
  const { farm, calls } = fakeFarm();
  const prod = await call(farm, "POST", "/api/devices/explore", { devices: "all", build: "prod" });
  assert.equal(prod.status, 400);
  assert.deepEqual(prod.json(), { error: prodExploreMessage });
  assert.equal(calls.explore, 0);
  assert.equal(farm.locks.ownerOf("A"), null);
  assert.equal(farm.locks.ownerOf("I"), null);
  assert.equal((await call(farm, "POST", "/api/devices/explore", { devices: ["A"] })).status, 202);
}

{
  const { farm, calls } = fakeFarm();
  const tap = { type: "tap", x: 0.5, y: 0.5 };
  const noLock = await call(farm, "POST", "/api/devices/A/input", tap);
  assert.equal(noLock.status, 423);
  assert.deepEqual(noLock.json(), { error: noLockMessage });

  assert.equal((await call(farm, "POST", "/api/devices/A/lock", undefined, { "tailscale-user-login": "kim@example" })).status, 200);
  assert.deepEqual(farm.locks.ownerOf("A"), { kind: "user", user: "kim@example" });
  assert.equal((await call(farm, "POST", "/api/devices/A/input", tap)).status, 423, "다른 사용자(local)의 입력");
  assert.equal((await call(farm, "POST", "/api/devices/A/input", tap, { "tailscale-user-login": "kim@example" })).status, 200);
  assert.deepEqual(calls.inputs, [tap]);
  const other = await call(farm, "POST", "/api/devices/A/lock");
  assert.equal(other.status, 409);
  assert.equal((await call(farm, "DELETE", "/api/devices/A/lock", undefined, { "tailscale-user-login": "kim@example" })).status, 200);
  assert.equal(farm.locks.ownerOf("A"), null);

  assert.equal((await call(farm, "POST", "/api/devices/I/lock")).status, 200);
  assert.deepEqual(farm.locks.ownerOf("I"), { kind: "user", user: "local" });
  const back = await call(farm, "POST", "/api/devices/I/input", { type: "key", key: "back" });
  assert.equal(back.status, 400);
  assert.deepEqual(back.json(), { error: iosBackUnsupported });
  assert.equal((await call(farm, "POST", "/api/devices/I/input", { type: "tap" })).status, 400);
}

{
  const { farm } = fakeFarm();
  const file = (relative: string) => call(farm, "GET", `/api/devices/files?path=${encodeURIComponent(relative)}`);
  const ok = await file("devices/run-1/A/s1/screenshot.png");
  assert.equal(ok.status, 200);
  assert.equal(ok.headers["content-type"], "image/png");
  assert.equal(ok.headers["cache-control"], "no-store");
  assert.equal(ok.body.toString(), "png");
  for (const escape of ["../secret.png", "devices/../../secret.png", path.join(scratch, "secret.png"), "devices/link.png", "devices/run-1/A/s1/notes.txt", "devices/none.png", ""]) {
    assert.equal((await file(escape)).status, 404, escape);
  }
}

{
  const { farm } = fakeFarm();
  assert.equal((await call(farm, "GET", "/api/devices")).status, 200);
  assert.equal((await call(farm, "GET", "/api/devices/runs/latest")).body.toString(), "null");
  assert.equal((await call(farm, "GET", "/api/devices/nope/what")).status, 404);
  assert.equal((await call(farm, "GET", "/api/devices/baselines/candidate?name=x")).status, 404);
  assert.equal(streamIdOf("/api/devices/R3CT/stream"), "R3CT");
  assert.equal(streamIdOf("/?token=vite-hmr"), null);
}

rmSync(scratch, { recursive: true, force: true });
// 접근 관문: 다른 도메인 계정은 API에서 403 JSON
{
  const { createAccessMiddleware } = await import("./device-api");
  const accessMiddleware = createAccessMiddleware(["example.com"]);
  const sent: { status?: number; body?: string; next: boolean } = { next: false };
  const req = { url: "/api/devices", headers: { "tailscale-user-login": "friend@gmail.com", "x-forwarded-for": "100.64.0.9" }, socket: { remoteAddress: "127.0.0.1" } };
  const res = {
    statusCode: 0,
    setHeader: () => undefined,
    end(body: string) {
      sent.status = this.statusCode;
      sent.body = body;
    },
  };
  accessMiddleware(req as unknown as IncomingMessage, res as unknown as ServerResponse, () => (sent.next = true));
  assert.equal(sent.next, false);
  assert.equal(sent.status, 403);
  assert.match(sent.body ?? "", /example\.com/);
  // 허용 도메인 계정은 통과
  const ok = { ...req, headers: { ...req.headers, "tailscale-user-login": "a@example.com" } };
  accessMiddleware(ok as unknown as IncomingMessage, res as unknown as ServerResponse, () => (sent.next = true));
  assert.equal(sent.next, true);
}

console.log("device-api ok");

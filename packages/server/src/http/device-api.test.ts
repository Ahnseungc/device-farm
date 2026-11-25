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

import { requestUser, setRequestUser } from "../auth/http";
import { createJobQueue, notQueuedMessage } from "../queue/job-queue";
import type { Farm } from "../types";
import { botLockMessage, createPacketGate, deviceMiddleware, noLockMessage, prodExploreMessage, streamIdOf } from "./device-api";

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

/** 진짜 대기열에 가짜 runDevices. 첫 실행은 release를 부를 때까지 끝나지 않는다. */
function fakeFarm() {
  const queue = createJobQueue({ onJobEnd: () => {}, log: () => {} });
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
    isBusy: queue.isBusy,
    jobQueue: () => queue.state(),
    cancelQueued: (id) => queue.cancel(id),
    listDevices: async () => devices.map((device) => ({ ...device, state: "idle" as const })),
    platformOf: async (id) => devices.find((device) => device.id === id)?.platform ?? null,
    startRun: () => {
      const runId = `run-${calls.runDevices + queue.state().pending.length + 1}`;
      const queued = queue.enqueue({
        kind: "run",
        label: "점검",
        source: "manual",
        ref: runId,
        work: async () => {
          calls.runDevices += 1;
          for (const device of devices) locks.acquire(device.id, { kind: "bot", runId });
          await pending;
        },
      });
      return queued.ok ? { ok: true, runId, position: queued.position } : queued;
    },
    stopRun: () => queue.isBusy(),
    stopJob: (kind) => kind === "bot" && queue.isBusy(),
    latestRun: () => null,
    pendingBaselines: () => [],
    candidatePng: () => null,
    confirmBaselines: () => 0,
    startExplore: () => {
      calls.explore += 1;
      const queued = queue.enqueue({ kind: "explore", label: "탐색", source: "manual", ref: "explore-1", work: async () => {} });
      return queued.ok ? { ok: true, runId: "explore-1", position: queued.position } : queued;
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
    runSummaries: () => [],
    designPages: () => [],
    runById: () => null,
    issues: () => [],
    setIssueStatus: async () => false,
    latestDailyReport: () => null,
    startBot: () => ({ ok: false, error: "봇 점검 중입니다." }),
  };
  return { farm, calls, release };
}

interface Reply {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
  json: () => unknown;
}

async function call(farm: Farm, method: string, url: string, body?: unknown, user?: string): Promise<Reply> {
  const req = Object.assign(Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]), { method, url, headers: {} });
  // 관문(auth)이 정한 사용자. 안 주면 호스트 자신(local)
  if (user) setRequestUser(req as unknown as IncomingMessage, user);
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
  assert.deepEqual(first.json(), { runId: "run-1", position: 0 });
  // 점검 중 두 번째 점검·탐색은 막지 않고 대기열 뒤에 쌓인다
  const second = await call(farm, "POST", "/api/devices/run", run);
  assert.equal(second.status, 202);
  assert.deepEqual(second.json(), { runId: "run-2", position: 1 });
  assert.equal(calls.runDevices, 1);

  const explore = await call(farm, "POST", "/api/devices/explore", { devices: "all", build: "dev" });
  assert.equal(explore.status, 202, "기기 점검 중 탐색 요청");
  assert.deepEqual(explore.json(), { runId: "explore-1", position: 2 });

  const listed = (await call(farm, "GET", "/api/devices/queue")).json() as { running: { ref: string }; pending: { id: string; kind: string }[] };
  assert.equal(listed.running.ref, "run-1");
  assert.deepEqual(listed.pending.map((job) => job.kind), ["run", "explore"]);
  // 기다리는 작업 빼기. 없는 id는 404, id가 없으면 400
  const canceled = await call(farm, "POST", "/api/devices/queue/cancel", { id: listed.pending[1].id });
  assert.equal(canceled.status, 200);
  assert.deepEqual(canceled.json(), { canceled: true });
  const again = await call(farm, "POST", "/api/devices/queue/cancel", { id: listed.pending[1].id });
  assert.equal(again.status, 404);
  assert.deepEqual(again.json(), { error: notQueuedMessage });
  assert.equal((await call(farm, "POST", "/api/devices/queue/cancel", {})).status, 400);

  const confirm = await call(farm, "POST", "/api/devices/baselines/confirm", {});
  assert.equal(confirm.status, 409);

  const locked = await call(farm, "POST", "/api/devices/A/lock");
  assert.equal(locked.status, 409);
  assert.deepEqual(locked.json(), { error: botLockMessage });

  // 도는 점검은 멈출 수 있다
  const stop = await call(farm, "POST", "/api/devices/run/stop");
  assert.equal(stop.status, 200);
  // 플로팅 「중지」: 종류별. 모르는 종류는 400
  assert.equal((await call(farm, "POST", "/api/devices/jobs/stop", { kind: "bot" })).status, 200);
  assert.equal((await call(farm, "POST", "/api/devices/jobs/stop", { kind: "nope" })).status, 400);
  release();
}

// 멈출 점검이 없으면 409
{
  const { farm } = fakeFarm();
  const stop = await call(farm, "POST", "/api/devices/run/stop");
  assert.equal(stop.status, 409);
  assert.deepEqual(stop.json(), { error: "멈출 점검이 없어요." });
  const job = await call(farm, "POST", "/api/devices/jobs/stop", { kind: "explore" });
  assert.equal(job.status, 409);
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
  // 이어서 돌리기: skipNames는 이름 배열, skipInstall은 참·거짓
  assert.equal((await call(farm, "POST", "/api/devices/run", { ...run, skipNames: "화면" })).status, 400);
  assert.equal((await call(farm, "POST", "/api/devices/run", { ...run, skipInstall: "yes" })).status, 400);
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

  assert.equal((await call(farm, "POST", "/api/devices/A/lock", undefined, "team@192.168.13.20")).status, 200);
  assert.deepEqual(farm.locks.ownerOf("A"), { kind: "user", user: "team@192.168.13.20" });
  assert.equal((await call(farm, "POST", "/api/devices/A/input", tap)).status, 423, "다른 사용자(local)의 입력");
  assert.equal((await call(farm, "POST", "/api/devices/A/input", tap, "team@192.168.13.20")).status, 200);
  assert.deepEqual(calls.inputs, [tap]);
  const other = await call(farm, "POST", "/api/devices/A/lock");
  assert.equal(other.status, 409);
  assert.equal((await call(farm, "DELETE", "/api/devices/A/lock", undefined, "team@192.168.13.20")).status, 200);
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
console.log("device-api ok");

// 느린 화면: 못 나간 바이트가 한도를 넘으면 다음 키프레임까지 건너뛰고, 키프레임에서 버퍼가 비었으면 다시 보낸다
{
  let buffered = 0;
  const pass = createPacketGate(() => buffered, 100);
  assert.equal(pass(false), true);
  buffered = 101;
  assert.equal(pass(false), false);
  assert.equal(pass(true), false, "아직 밀려 있으면 키프레임도 건너뛴다");
  buffered = 0;
  assert.equal(pass(false), false, "키프레임 전 조각은 건너뛴다");
  assert.equal(pass(true), true);
  assert.equal(pass(false), true);
}

// 접근 관문: 다른 도메인 계정은 API에서 403 JSON, 허용 계정은 통과하고 사용자 이름이 정해진다
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
  assert.equal(requestUser(ok as unknown as IncomingMessage), "a@example.com");
}

// 디자인 점검 요청: 경로를 주면 설치 없이 그 화면만(라벨에 경로), 경로 형식이 틀리면 400
{
  const requests: unknown[] = [];
  const designFarm = { startRun: (request: unknown) => (requests.push(request), { ok: true, runId: "d-1" }), designPages: () => [] } as unknown as Farm;
  assert.equal((await call(designFarm, "POST", "/api/devices/run", { kind: "dev", devices: "all", designPaths: ["/home"] })).status, 202);
  assert.deepEqual(requests.at(-1), {
    kind: "dev",
    version: "설치된 앱",
    deviceIds: "all",
    flowsOnly: false,
    flowIds: undefined,
    buttonCheck: false,
    designOnly: true,
    designPaths: ["/home"],
    label: "디자인 점검 · /home",
  });
  assert.equal((await call(designFarm, "POST", "/api/devices/run", { kind: "dev", devices: "all", designOnly: true })).status, 202);
  assert.equal((requests.at(-1) as { label: string }).label, "디자인 점검");
  assert.equal((await call(designFarm, "POST", "/api/devices/run", { kind: "dev", devices: "all", designPaths: ["home"] })).status, 400);
  assert.deepEqual((await call(designFarm, "GET", "/api/devices/design")).json(), []);
}

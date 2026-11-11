import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";

import type { ScreenDriver } from "@device-farm/core/device/driver";
import { DeviceLocks } from "@device-farm/core/device/lock";
import type { Device, DeviceRun, ScreenStatus } from "@device-farm/core/device/types";
import { LogRing } from "@device-farm/core/logs/ring";
import type { ScreenScenario } from "@device-farm/core/scenarios";

import type { ScreenCheck } from "./check";
import type { FailureBundleInput } from "./results";
import { humanControlMessage, runDevices, stoppedMessage, type RunDeps } from "./run";
import { sampleApp } from "@device-farm/core/config/sample-app";

function device(id: string, platform: Device["platform"] = "android"): Device {
  return { id, platform, model: `model-${id}`, osVersion: "14", appVersion: null };
}

function scenario(name: string): ScreenScenario {
  return { path: `/${name}`, name, when: name, then: name };
}

const scenarios = [scenario("s1"), scenario("s2"), scenario("s3")];

const driver: ScreenDriver = {
  app: sampleApp,
  navigate: async () => {},
  clickButton: async () => {},
  expectText: async () => {},
  currentPath: async () => "/",
  hasText: async () => false,
  screenshot: async () => Buffer.alloc(0),
  evaluate: async <T>() => undefined as T,
  close: async () => {},
};

type Plan = Record<string, Partial<Record<string, ScreenStatus | Error>>>;

function deps(devices: Device[], plan: Plan, overrides: Partial<RunDeps> = {}): RunDeps & { updates: DeviceRun[]; checked: string[] } {
  const updates: DeviceRun[] = [];
  const checked: string[] = [];
  return {
    updates,
    checked,
    app: sampleApp,
    exec: async () => "",
    locks: new DeviceLocks(),
    listDevices: async () => devices,
    fetchBuild: async ({ platform }) => `/builds/${platform}`,
    installAndLaunch: async () => ({ ok: true }),
    openDriver: async () => driver,
    scenarios,
    onUpdate: (run) => updates.push(structuredClone(run)),
    checkScreen: async (_driver, target, item): Promise<ScreenCheck> => {
      checked.push(`${target.id}:${item.name}`);
      const planned = plan[target.id]?.[item.name] ?? "passed";
      if (planned instanceof Error) throw planned;
      return { status: planned };
    },
    ...overrides,
  };
}

function statusOf(run: DeviceRun, id: string): string {
  return run.outcomes.find((outcome) => outcome.device.id === id)?.status ?? "missing";
}

const request = { kind: "dev", version: "2.1.5", deviceIds: "all" } as const;

{
  const fake = deps([device("A"), device("B")], { A: { s2: new Error("device disconnected") } });
  const run = await runDevices(request, fake);
  assert.equal(statusOf(run, "A"), "offline");
  assert.equal(statusOf(run, "B"), "passed");
  assert.equal(fake.locks.ownerOf("A"), null);
  assert.equal(fake.locks.ownerOf("B"), null);
  assert.ok(run.finishedAt);
  assert.equal(run.trigger, "manual");
  assert.ok(fake.updates.length > 2);
  assert.equal(fake.updates[0].finishedAt, null);
}

{
  const fake = deps([device("A"), device("B")], {});
  fake.locks.acquire("A", { kind: "user", user: "qa-user" });
  const run = await runDevices({ ...request, trigger: "auto" }, fake);
  assert.equal(statusOf(run, "A"), "skipped");
  assert.equal(run.outcomes[0].message, humanControlMessage);
  assert.equal(statusOf(run, "B"), "passed");
  assert.deepEqual(fake.locks.ownerOf("A"), { kind: "user", user: "qa-user" });
  assert.equal(run.trigger, "auto");
}

{
  const fake = deps([device("A", "ios"), device("B")], {}, {
    fetchBuild: async ({ platform }) => {
      if (platform === "ios") throw new Error("ios prod 2.1.5 빌드가 Firebase에 없습니다.");
      return "/builds/android";
    },
  });
  // iOS 운영은 Firebase Ad-hoc을 깐다
  const run = await runDevices({ ...request, kind: "prod" }, fake);
  assert.equal(statusOf(run, "A"), "install_failed");
  assert.equal(run.outcomes[0].message, "ios prod 2.1.5 빌드가 Firebase에 없습니다.");
  assert.equal(statusOf(run, "B"), "passed");
}

// iOS dev는 TestFlight가 깐 버전을 기다린다. Firebase에서 받지 않는다
{
  const fetched: string[] = [];
  const waited: string[] = [];
  const fake = deps([device("A", "ios")], {}, {
    fetchBuild: async ({ platform }) => {
      fetched.push(platform);
      return "/builds/x";
    },
    waitForTestflight: async (target, kind, version) => {
      waited.push(`${target.id} ${kind} ${version}`);
      return { ok: true };
    },
  });
  const run = await runDevices(request, fake);
  assert.deepEqual(fetched, []);
  assert.deepEqual(waited, ["A dev 2.1.5"]);
  assert.equal(statusOf(run, "A"), "passed");
}

// TestFlight 대기 시간 초과는 install_failed와 이유
{
  const fake = deps([device("A", "ios")], {}, {
    waitForTestflight: async () => ({ ok: false, message: "TestFlight에서 2.1.5이 30분 안에 설치되지 않았습니다." }),
  });
  const run = await runDevices(request, fake);
  assert.equal(statusOf(run, "A"), "install_failed");
  assert.match(run.outcomes[0].message ?? "", /TestFlight/);
}

{
  const fake = deps([device("A")], {}, { installAndLaunch: async () => ({ ok: false, message: "INSTALL_FAILED" }) });
  const run = await runDevices(request, fake);
  assert.equal(statusOf(run, "A"), "install_failed");
  assert.equal(fake.locks.ownerOf("A"), null);
}

{
  const fake = deps([device("A")], { A: { s2: "login_required" } });
  const run = await runDevices(request, fake);
  assert.equal(statusOf(run, "A"), "login_required");
  assert.deepEqual(fake.checked, ["A:s1", "A:s2"]);
}

{
  const fake = deps([device("A")], { A: { s1: "failed", s2: "login_required" } });
  const run = await runDevices(request, fake);
  assert.equal(statusOf(run, "A"), "failed");
}

{
  const fake = deps([device("A"), device("B"), device("C")], {});
  let active = 0;
  let peak = 0;
  fake.openDriver = async () => {
    active += 1;
    peak = Math.max(peak, active);
    await setImmediate();
    active -= 1;
    return driver;
  };
  const all = await runDevices(request, fake);
  assert.equal(all.outcomes.length, 3);
  assert.equal(peak, 2);
  const picked = await runDevices({ ...request, deviceIds: ["A", "C"] }, fake);
  assert.deepEqual(picked.outcomes.map((outcome) => outcome.device.id), ["A", "C"]);
}

{
  const fake = deps([device("A")], {});
  const shotFromCheck = Buffer.from("checked");
  fake.checkScreen = async (_driver, _target, item) => (item.name === "s2" ? { status: "failed", message: "기준 화면과 다릅니다.", screenshot: shotFromCheck } : { status: "passed" });
  const ring = new LogRing(30_000, () => 1_000);
  ring.push({ source: "console", text: "boom" });
  const bundles: Array<{ dir: string; input: FailureBundleInput }> = [];
  let stopped = 0;
  const shot = Buffer.from("png");
  const run = await runDevices({ ...request, runId: "run-1" }, {
    ...fake,
    now: () => 1_000,
    resultsRoot: "/farm/test-results",
    capture: async () => ({ ring, frames: () => [], stop: async () => { stopped += 1; } }),
    baselineFor: () => ({ baseline: Buffer.from("base"), diff: Buffer.from("diff") }),
    writeBundle: async (dir, input) => {
      bundles.push({ dir, input });
    },
    openDriver: async () => ({ ...driver, screenshot: async () => shot }),
  });
  assert.equal(run.runId, "run-1");
  assert.equal(bundles.length, 1);
  assert.equal(bundles[0].dir, "/farm/test-results/devices/run-1/A/s2");
  assert.deepEqual(bundles[0].input.logs.map((entry) => entry.text), ["boom"]);
  assert.equal(bundles[0].input.screenshot, shotFromCheck);
  assert.ok(bundles[0].input.baseline);
  const [passed, failed] = run.outcomes[0].screens;
  assert.equal(passed.screenshot, undefined);
  assert.equal(passed.logDir, undefined);
  assert.equal(failed.screenshot, "devices/run-1/A/s2/screenshot.png");
  assert.equal(failed.logDir, "devices/run-1/A/s2");
  assert.equal(stopped, 1);
}

// 진행 패널용: 시나리오 수, 단계, 지금 화면을 내보내고 끝나면 지운다
{
  const snapshots: Array<{ phase?: string; current?: string; count?: number }> = [];
  const fake = deps([device("A")], {}, {
    onUpdate: (run) => snapshots.push({ phase: run.outcomes[0]?.phase, current: run.outcomes[0]?.current, count: run.scenarioCount }),
  });
  const run = await runDevices(request, fake);
  assert.ok(snapshots.some((item) => item.phase === "installing"));
  assert.ok(snapshots.some((item) => item.phase === "checking" && typeof item.current === "string"));
  assert.equal(run.scenarioCount, fake.scenarios.length);
  assert.equal(run.outcomes[0].phase, undefined);
  assert.equal(run.outcomes[0].current, undefined);
}

// 확정 플로우는 화면 시나리오 뒤에 돌고, 실패하면 기기 결과도 failed. 로그인 이탈이면 플로우를 열지 않는다.
{
  const flow = (name: string) => ({ id: name, name, source: "ai_generated" as const, status: "ready" as const, prd: "a.md", requirement: "r", steps: [] });
  const ran: string[] = [];
  const stepViews: string[] = [];
  const fake = deps([device("A")], {}, {
    flows: [flow("f1"), { ...flow("f2"), steps: [{ type: "click", target: { role: "link", name: "혜택" } }, { type: "click", target: { role: "button", name: "출석체크" } }] }],
    onUpdate: (run) => {
      const views = run.outcomes[0]?.flowSteps;
      if (views) stepViews.push(views.map((view) => `${view.status}:${view.label}`).join(","));
    },
    runFlow: async (_driver, item, onStep) => {
      [{}, ...item.steps].forEach((_step, index) => onStep(index));
      ran.push(item.name);
      return item.name === "f2" ? { status: "failed", steps: [], message: "2단계 실패" } : { status: "passed", steps: [] };
    },
  });
  const run = await runDevices(request, fake);
  assert.deepEqual(ran, ["f1", "f2"]);
  assert.equal(run.scenarioCount, scenarios.length + 2);
  assert.deepEqual(run.outcomes[0].screens.slice(-2).map((screen) => [screen.scenario, screen.status]), [["플로우 · f1", "passed"], ["플로우 · f2", "failed"]]);
  assert.equal(statusOf(run, "A"), "failed");
  // 진행 패널: 지금 스텝은 running, 앞 스텝은 passed. 플로우가 끝나면 지운다.
  assert.equal(stepViews.at(-1), "passed:홈에서 시작 「홈」,passed:누르기 「혜택」,running:누르기 「출석체크」");
  assert.equal(run.outcomes[0].flowSteps, undefined);

  const loggedOut: string[] = [];
  await runDevices(request, deps([device("B")], { B: { s1: "login_required" } }, { flows: [flow("f1")], runFlow: async (_driver, item) => (loggedOut.push(item.name), { status: "passed", steps: [] }) }));
  assert.deepEqual(loggedOut, []);
}

// 데이터 QA는 플로우 뒤에 돌고, 규칙이 하나라도 실패하면 그 화면과 기기가 failed. 첫 실패 사유를 남긴다.
{
  const screen = (name: string) => ({ path: `/${name}`, name, apis: {}, rules: [] });
  const ran: string[] = [];
  const fake = deps([device("A")], {}, {
    qaScreens: [screen("q1"), screen("q2")],
    runQa: async (_driver, item) => {
      ran.push(item.name);
      const failing = item.name === "q2" ? [{ id: "total", title: "총자산 = 구성 항목 합", ok: false, message: "1원 차이" }] : [];
      return { path: item.path, name: item.name, apis: [], checks: [{ id: "ok", title: "통과 규칙", ok: true }, ...failing] };
    },
  });
  const run = await runDevices(request, fake);
  assert.deepEqual(ran, ["q1", "q2"]);
  assert.equal(run.scenarioCount, scenarios.length + 2);
  const [q1, q2] = run.outcomes[0].screens.slice(-2);
  assert.deepEqual([q1.scenario, q1.status, q2.scenario, q2.status], ["데이터 · q1", "passed", "데이터 · q2", "failed"]);
  assert.equal(q2.message, "1개 실패 · 총자산 = 구성 항목 합: 1원 차이");
  assert.equal(q2.checks?.length, 2);
  assert.equal(statusOf(run, "A"), "failed");

  // runQa가 없으면(API 주소 없음) 화면 수에도 넣지 않고 돌지 않는다
  const skipped = await runDevices(request, deps([device("B")], {}, { qaScreens: [screen("q1")] }));
  assert.equal(skipped.scenarioCount, scenarios.length);
}

// 플로우만: 설치·화면 점검 없이 확정 플로우만 돈다
{
  let installs = 0;
  const flowsRan: string[] = [];
  const flow = { id: "f", name: "f", source: "ai_generated" as const, status: "ready" as const, prd: "a.md", requirement: "r", steps: [] };
  const fake = deps([device("A")], {}, {
    flows: [flow],
    installAndLaunch: async () => ((installs += 1), { ok: true }),
    runFlow: async (_driver, item) => (flowsRan.push(item.name), { status: "passed", steps: [] }),
  });
  const run = await runDevices({ ...request, flowsOnly: true }, fake);
  assert.equal(installs, 0);
  assert.deepEqual(fake.checked, []);
  assert.deepEqual(flowsRan, ["f"]);
  assert.equal(run.scenarioCount, 1);
  assert.equal(statusOf(run, "A"), "passed");
}

// 버튼 눌러보기: 켜면 정상 화면마다 누르고, 에러 버튼이 있으면 그 화면은 failed. 가드를 못 걸면 누르지 않고 이유를 남긴다.
{
  const pressedOn: string[] = [];
  const mapped: string[] = [];
  const setup = {
    guard: async () => async () => undefined,
    probe: async () => [],
    checkButtons: async (target: ScreenDriver) => {
      const path = await target.currentPath();
      pressedOn.push(path);
      return pressedOn.length === 2 ? [{ role: "button" as const, name: "저장", status: "error" as const, message: "POST /x 500" }] : [{ role: "button" as const, name: "열기", status: "reacted" as const }];
    },
    recordMap: (from: string) => {
      mapped.push(from);
      // 지도 기록이 실패해도 점검 결과는 그대로다
      if (mapped.length === 1) throw new Error("디스크 가득 참");
    },
  };
  const fake = deps([device("A")], { A: { s3: "login_required" } }, { buttonCheck: setup });
  const run = await runDevices({ ...request, buttonCheck: true }, fake);
  assert.equal(pressedOn.length, 2);
  assert.equal(mapped.length, 2);
  assert.deepEqual(run.outcomes[0].screens.map((screen) => screen.status), ["passed", "failed", "login_required"]);
  assert.equal(run.outcomes[0].screens[1].message, "버튼 1개 · 에러 1(저장)");

  const off = await runDevices(request, deps([device("B")], {}, { buttonCheck: setup }));
  assert.equal(off.outcomes[0].screens[0].buttons, undefined);

  let checked = 0;
  const noGuard = { ...setup, guard: async () => { throw new Error("Android 드라이버가 아니라 요청 가드를 켤 수 없습니다."); }, checkButtons: async () => ((checked += 1), []) };
  const ios = await runDevices({ ...request, buttonCheck: true }, deps([device("C")], {}, { buttonCheck: noGuard }));
  assert.equal(checked, 0);
  assert.match(ios.outcomes[0].message ?? "", /^버튼 눌러보기를 건너뜀/);
  assert.equal(statusOf(ios, "C"), "passed");
}

// 점검 멈추기: 멈춘 뒤에는 남은 화면·플로우를 돌지 않고, 실패가 없으면 건너뜀으로 끝난다.
{
  const abort = new AbortController();
  const fake = deps([device("A")], {}, { signal: abort.signal, onUpdate: (current) => {
    if (current.outcomes[0].screens.length === 1) abort.abort();
  } });
  const run = await runDevices(request, fake);
  assert.equal(run.outcomes[0].screens.length, 1);
  assert.equal(run.outcomes[0].status, "skipped");
  assert.equal(run.outcomes[0].message, stoppedMessage);
}

console.log("run ok");

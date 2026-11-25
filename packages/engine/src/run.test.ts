import assert from "node:assert/strict";

import { diffMessage } from "@device-farm/core/baseline/diff";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setImmediate } from "node:timers/promises";

import type { ScreenDriver } from "@device-farm/core/device/driver";
import { DeviceLocks } from "@device-farm/core/device/lock";
import type { Device, DeviceRun, ScreenStatus } from "@device-farm/core/device/types";
import { LogRing } from "@device-farm/core/logs/ring";
import type { ScreenScenario } from "@device-farm/core/scenarios";

import type { ScreenCheck } from "./check";
import type { FailureBundleInput } from "./results";
import { buttonsSeenElsewhere, externalSiteNote, humanControlMessage, runDevices, stoppedMessage, type RunDeps } from "./run";
import { sampleApp } from "@device-farm/core/config/sample-app";

function device(id: string, platform: Device["platform"] = "android"): Device {
  return { id, platform, model: `model-${id}`, osVersion: "14", appVersion: null };
}

function scenario(name: string): ScreenScenario {
  return { path: `/${name}`, name, when: name, then: name };
}

const scenarios = [scenario("s1"), scenario("s2"), scenario("s3")];

/** 가짜 checkScreen이 연 화면 경로 */
let openPath = "/";

const driver: ScreenDriver = {
  app: sampleApp,
  navigate: async () => {},
  clickButton: async () => {},
  expectText: async () => {},
  currentPath: async () => openPath,
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
      openPath = item.path;
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

// 깨진 화면만 `화면 깨짐 점검 · 경로`로 남고, 같은 경로는 한 번만 잰다
{
  const measured: string[] = [];
  const fake = deps([device("A")], {}, {
    scenarios: [scenario("s1"), scenario("s1-again"), scenario("s2")].map((item) => ({ ...item, path: item.name === "s2" ? "/ok" : "/broken" })),
    checkLayout: async (_driver, screenPath) => {
      measured.push(screenPath);
      return [{ id: "layout-overlap", title: "글자 겹침", ok: screenPath !== "/broken", message: "글자끼리 겹칩니다: 「a」↔「b」" }];
    },
  });
  const run = await runDevices(request, fake);
  assert.deepEqual(measured, ["/broken", "/ok"]);
  const layout = run.outcomes[0].screens.filter((screen) => screen.scenario.startsWith("화면 깨짐 점검 · "));
  assert.deepEqual(layout.map((screen) => [screen.scenario, screen.status]), [["화면 깨짐 점검 · /broken", "failed"]]);
  assert.equal(statusOf(run, "A"), "failed");
}

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
  // 실패한 f2는 한 번 더 돈다
  assert.deepEqual(ran, ["f1", "f2", "f2"]);
  assert.equal(run.scenarioCount, scenarios.length + 2);
  assert.deepEqual(run.outcomes[0].screens.slice(-2).map((screen) => [screen.scenario, screen.status]), [["플로우 점검 · f1", "passed"], ["플로우 점검 · f2", "failed"]]);
  assert.equal(statusOf(run, "A"), "failed");
  // 진행 패널: 지금 스텝은 running, 앞 스텝은 passed. 플로우가 끝나면 지운다.
  assert.equal(stepViews.at(-1), "passed:홈에서 시작 「홈」,passed:누르기 「혜택」,running:누르기 「출석체크」");
  assert.equal(run.outcomes[0].flowSteps, undefined);

  // 끝나지 않는 플로우는 시간 제한 뒤 실패로 남기고 다음 플로우로 간다(멈춘 WebView로 대기열이 막히지 않게)
  const after: string[] = [];
  const hung = await runDevices(request, deps([device("A")], {}, {
    flows: [{ ...flow("멈춤"), steps: [{ type: "click", target: { role: "button", name: "광고 시청" } }] }, flow("다음")],
    flowTimeoutMs: 50,
    runFlow: async (_driver, item, onStep) => {
      if (item.name === "멈춤") {
        onStep(1);
        return new Promise(() => undefined);
      }
      after.push(item.name);
      return { status: "passed", steps: [] };
    },
  }));
  assert.deepEqual(after, ["다음"]);
  assert.deepEqual(hung.outcomes[0].screens.slice(-2).map((screen) => [screen.status, screen.message]), [
    // 시간 제한은 멈춘 WebView 때문이라 앱 실패가 아니라 점검 못 함
    ["inconclusive", "플로우가 0분 안에 끝나지 않아 2단계 누르기 「광고 시청」에서 멈추고 다음으로 넘어갔습니다."],
    ["passed", undefined],
  ]);

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
  assert.deepEqual([q1.scenario, q1.status, q2.scenario, q2.status], ["데이터 점검 · q1", "passed", "데이터 점검 · q2", "failed"]);
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

  // 플로우 하나만: 고른 플로우만 돌고 데이터 점검은 건너뛴다
  flowsRan.length = 0;
  let qaRan = 0;
  const one = await runDevices(
    { ...request, flowsOnly: true, flowIds: ["g"] },
    deps([device("A")], {}, {
      flows: [flow, { ...flow, id: "g", name: "g" }],
      runFlow: async (_driver, item) => (flowsRan.push(item.name), { status: "passed", steps: [] }),
      qaScreens: [{ path: "/q", name: "q", apis: {}, rules: [] }],
      runQa: async () => ((qaRan += 1), { path: "/q", name: "q", apis: [], checks: [] }),
    }),
  );
  assert.deepEqual(flowsRan, ["g"]);
  assert.equal(qaRan, 0);
  assert.equal(one.scenarioCount, 1);

  // 화면 골라 다시 점검: 설치·플로우·데이터 점검 없이 고른 화면만(목록 순서)
  flowsRan.length = 0;
  qaRan = 0;
  let reinstalls = 0;
  const picked = deps([device("A")], {}, {
    flows: [flow],
    installAndLaunch: async () => ((reinstalls += 1), { ok: true }),
    runFlow: async (_driver, item) => (flowsRan.push(item.name), { status: "passed", steps: [] }),
    qaScreens: [{ path: "/q", name: "q", apis: {}, rules: [] }],
    runQa: async () => ((qaRan += 1), { path: "/q", name: "q", apis: [], checks: [] }),
  });
  const again = await runDevices({ ...request, scenarioNames: ["s2", "s1", "없는 화면"] }, picked);
  assert.equal(reinstalls, 0);
  assert.deepEqual(picked.checked, ["A:s1", "A:s2"]);
  assert.deepEqual(flowsRan, []);
  assert.equal(qaRan, 0);
  assert.equal(again.scenarioCount, 2);

  // 이어서 돌리기: 이미 본 화면·플로우는 건너뛰고 설치하지 않는다
  flowsRan.length = 0;
  let resumedInstalls = 0;
  const resumed = deps([device("A")], {}, {
    flows: [flow, { ...flow, id: "g", name: "g" }],
    installAndLaunch: async () => ((resumedInstalls += 1), { ok: true }),
    // 위 deepEqual(flowsRan, [])가 타입을 never[]로 좁혀 다시 넓힌다
    runFlow: async (_driver, item) => ((flowsRan as string[]).push(item.name), { status: "passed", steps: [] }),
  });
  const cont = await runDevices({ ...request, skipNames: ["s1", "플로우 점검 · f"], skipInstall: true }, resumed);
  assert.equal(resumedInstalls, 0);
  assert.deepEqual(resumed.checked, ["A:s2", "A:s3"]);
  assert.deepEqual(flowsRan, ["g"]);
  assert.equal(cont.scenarioCount, 3);
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
  assert.equal(run.outcomes[0].screens[1].message, "버튼 1개 · 에러 1(저장) · 에러 원인: POST /x 500");

  // 기준 화면과 그림만 다른 화면도 버튼을 누른다. 다른 실패(안 열림)는 누르지 않는다
  const diffPressed: string[] = [];
  const diffSetup = { ...setup, recordMap: () => undefined, checkButtons: async (target: ScreenDriver) => ((diffPressed.push(await target.currentPath())), []) };
  // 시나리오 이름으로 결과를 정한다(실패한 s2는 다시 돌아 호출 순서가 밀린다)
  const diffPlan: Record<string, ScreenCheck> = { s1: { status: "failed", message: diffMessage }, s2: { status: "failed", message: "화면이 열리지 않았습니다." }, s3: { status: "passed" } };
  const diffRun = await runDevices(
    { ...request, buttonCheck: true },
    deps([device("D")], {}, {
      buttonCheck: diffSetup,
      checkScreen: async (_driver, _target, item): Promise<ScreenCheck> => ((openPath = item.path), diffPlan[item.name]),
    }),
  );
  assert.equal(diffPressed.length, 2);

  // 시나리오 주소가 넘어가 열리면 실제 주소로 비교·기록한다(「/」 → 「/home」)
  const seen: { screenPath: string; from: string }[] = [];
  const redirected = { ...driver, currentPath: async () => "/home" };
  await runDevices(
    { ...request, buttonCheck: true },
    deps([device("E")], {}, {
      openDriver: async () => redirected,
      buttonCheck: { ...setup, recordMap: (from: string) => void seen.push({ screenPath: "", from }), checkButtons: async (_target: ScreenDriver, options: { screenPath: string }) => ((seen.push({ screenPath: options.screenPath, from: "" })), []) },
    }),
  );
  assert.ok(seen.length > 0 && seen.every((item) => (item.screenPath || item.from) === "/home"));
  // 셋 다 같은 화면으로 넘어가면 버튼은 한 번만 누른다. 그 화면을 따로 보는 시나리오가 있으면 거기서만 누른다
  assert.equal(seen.filter((item) => item.screenPath).length, 1);
  {
    const pressed: string[] = [];
    const run = await runDevices(
      { ...request, buttonCheck: true },
      deps([device("H")], {}, {
        openDriver: async () => ({ ...driver, currentPath: async () => "/s3" }),
        buttonCheck: { ...setup, recordMap: () => undefined, checkButtons: async (_target: ScreenDriver, options: { screenPath: string }) => ((pressed.push(options.screenPath)), []) },
      }),
    );
    assert.deepEqual(pressed, ["/s3"]);
    assert.deepEqual(run.outcomes[0].screens.map((screen) => screen.message), [buttonsSeenElsewhere("/s3"), buttonsSeenElsewhere("/s3"), "버튼 0개"]);
  }
  // 바깥 사이트(본인인증)로 넘어간 화면의 버튼은 누르지 않는다
  {
    const pressed: string[] = [];
    const run = await runDevices(
      { ...request, buttonCheck: true },
      deps([device("X")], {}, {
        openDriver: async () => ({ ...driver, currentPath: async () => "/Auth/Start.php", onAppSite: async () => false }),
        buttonCheck: { ...setup, recordMap: () => undefined, checkButtons: async (_target: ScreenDriver, options: { screenPath: string }) => ((pressed.push(options.screenPath)), []) },
      }),
    );
    assert.deepEqual(pressed, []);
    assert.ok(run.outcomes[0].screens.every((screen) => screen.message === externalSiteNote));
  }
  // 기준과 다른 화면에서 버튼 에러도 나면 비교 그림을 잃지 않는다
  {
    const bundles: boolean[] = [];
    await runDevices(
      { ...request, buttonCheck: true },
      deps([device("I")], {}, {
        scenarios: [scenario("s1")],
        checkScreen: async (_driver, _target, item): Promise<ScreenCheck> => ((openPath = item.path), { status: "failed", message: diffMessage, screenshot: Buffer.from("x") }),
        capture: async () => ({ ring: new LogRing(), frames: () => [], stop: async () => undefined }) as never,
        baselineFor: () => ({ baseline: Buffer.from("b"), diff: Buffer.from("d") }),
        writeBundle: async (_dir, input) => void bundles.push(input.baseline !== undefined),
        buttonCheck: { ...setup, recordMap: () => undefined, checkButtons: async () => [{ role: "button" as const, name: "저장", status: "error" as const, message: "POST /x 500" }] },
      }),
    );
    assert.deepEqual(bundles, [true]);
  }
  assert.deepEqual(diffRun.outcomes[0].screens.map((screen) => screen.status), ["failed", "failed", "passed"]);

  // 버튼 눌러보기 중 화면이 넘어가 evaluate가 깨져도 기기째 끝나지 않는다. 그 화면 결과는 그대로, 다음 화면도 돈다
  {
    let calls = 0;
    const broken = { ...setup, recordMap: () => undefined, checkButtons: async () => { calls += 1; if (calls === 1) throw new Error("page.evaluate: Execution context was destroyed, most likely because of a navigation\nstack"); return []; } };
    const run = await runDevices({ ...request, buttonCheck: true }, deps([device("F")], {}, { buttonCheck: broken }));
    const screens = run.outcomes[0].screens;
    assert.equal(screens.length, 3);
    assert.equal(screens[0].status, "passed");
    assert.equal(screens[0].message, "버튼 눌러보기 중단: page.evaluate: Execution context was destroyed, most likely because of a navigation");
    assert.equal(calls, 3);
  }
  // 쓰기 요청 가드는 버튼을 누르는 동안만 켠다. 플로우(광고 시작 요청)까지 막으면 광고 적립이 앱 오류가 된다
  {
    let guarded = false;
    const guardLog: string[] = [];
    const scoped = {
      ...setup,
      recordMap: () => undefined,
      guard: async () => ((guarded = true), guardLog.push("on"), async () => void ((guarded = false), guardLog.push("off"))),
      checkButtons: async () => (assert.equal(guarded, true, "누르는 동안은 켜져 있다"), []),
    };
    const flowGuard: boolean[] = [];
    await runDevices(
      { ...request, buttonCheck: true },
      deps([device("G")], {}, { buttonCheck: scoped, flows: [{ id: "ad", name: "ad", source: "ai_generated" as const, status: "ready" as const, prd: "a.md", requirement: "r", steps: [] }], runFlow: async () => ((flowGuard.push(guarded)), { status: "passed" as const, steps: [] }) }),
    );
    assert.deepEqual(flowGuard, [false], "플로우 중에는 꺼져 있다");
    assert.equal(guardLog.filter((item) => item === "on").length, guardLog.filter((item) => item === "off").length);
  }
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


// 플로우 중에 뜬 팝업은 `팝업 · 제목`으로 한 번만 남기고 닫은 뒤 플로우를 이어 간다
{
  let open = true;
  const clicks: string[] = [];
  const popupDriver: ScreenDriver = {
    ...driver,
    currentPath: async () => "/benefit",
    goHome: async () => {
      open = true; // 홈에 갈 때마다 뜨는 안내
    },
    clickButton: async (name) => {
      clicks.push(name);
      if (name === "이동") open = false;
      else if (open) throw new Error(`"${name}" 링크가 다른 요소(div.bg-bg-dim.absolute)에 가려져 있습니다.`);
    },
    evaluate: async <T>() =>
      (open ? { title: "적립 단위 변경 안내", texts: ["적립 단위 변경 안내", "이동"], buttons: [{ name: "이동", reachable: true }], dim: null } : null) as T,
  };
  const flow = (id: string) => ({ id, name: id, source: "recorded" as const, status: "ready" as const, prd: "p", requirement: "r", steps: [{ type: "click" as const, target: { role: "link" as const, name: "홈" } }] });
  const fake = deps([device("A")], {}, {
    openDriver: async () => popupDriver,
    flows: [flow("f1"), flow("f2")],
    runFlow: async (target) => {
      await target.goHome?.();
      await target.clickButton("홈", "link");
      return { status: "passed", steps: [] };
    },
    checkPopupDesign: (path) => [{ id: `figma:${path}:extra:이동`, title: "피그마 문구 「이동」", ok: false, message: "[피그마 차이] 화면에 있는데 피그마에 없습니다.", ignoreKey: `figma:${path}:extra:이동`, ignoreHash: "h" }],
  });
  const run = await runDevices({ ...request, flowsOnly: true }, fake);
  const screens = run.outcomes[0].screens;
  assert.deepEqual(screens.map((screen) => [screen.scenario, screen.status]), [
    ["팝업 · 적립 단위 변경 안내", "passed"],
    ["플로우 점검 · f1", "passed"],
    ["플로우 점검 · f2", "passed"],
  ]);
  const popup = screens[0];
  assert.equal(popup.message, "/benefit에서 뜸 · 닫기가 없어 「이동」을 누름");
  assert.deepEqual(popup.checks?.map((check) => [check.id, check.ok]), [["popup-shown", true], ["popup-closed", true], ["figma:/benefit:extra:이동", false]]);
  assert.equal(clicks.filter((name) => name === "홈").length, 2);
}

// 기기·연결 실패는 화면 점검·데이터 점검 모두 실패 대신 점검 못 함으로 남고, 기기는 통과
{
  const lost = "Android 앱에서 웹 화면을 찾지 못했습니다. 로그아웃돼 네이티브 로그인 화면일 수 있습니다.";
  const qa = (name: string) => ({ path: `/${name}`, name, apis: {}, rules: [] });
  const fake = deps([device("A")], {}, {
    scenarios: [scenario("s1")],
    checkScreen: async () => ({ status: "failed", message: lost }),
    qaScreens: [qa("q1")],
    runQa: async (_driver, item) => ({ path: item.path, name: item.name, apis: [], checks: [{ id: "run", title: "데이터 QA 실행", ok: false, message: lost }] }),
  });
  const run = await runDevices(request, fake);
  const statuses = run.outcomes[0].screens.map((screen) => screen.status);
  assert.deepEqual(statuses, ["inconclusive", "inconclusive"]);
  assert.equal(statusOf(run, "A"), "passed");
}

// ── 실패하면 한 번 다시 돌린다  ──
{
  const lost = "WebDriverError: A session is either terminated or not started";
  const slow = (name: string) => `/${name} 화면이 15초 안에 그려지지 않았습니다.`;
  const quiet = { capture: async () => ({ ring: new LogRing(), frames: () => [], stop: async () => undefined }), resultsRoot: mkdtempSync(path.join(tmpdir(), "farm-retry-")) };
  /** 시나리오별 n번째 호출 결과 */
  const sequence = (plan: Record<string, ScreenCheck[]>) => {
    const calls: Record<string, number> = {};
    return async (_driver: ScreenDriver, _target: Device, item: ScreenScenario): Promise<ScreenCheck> => {
      const index = (calls[item.name] = (calls[item.name] ?? 0) + 1) - 1;
      const list = plan[item.name] ?? [{ status: "passed" }];
      return list[Math.min(index, list.length - 1)];
    };
  };
  const countingOpen = () => {
    const counter = { opened: 0 };
    return { counter, openDriver: async () => (counter.opened++, driver) };
  };

  // 앱 실패 → 통과: 통과로 남고 첫 메시지를 붙인다
  {
    let calls = 0;
    const run = await runDevices(request, deps([device("A")], {}, { ...quiet, scenarios: [scenario("s1")], checkScreen: async () => (calls++ === 0 ? { status: "failed", message: slow("s1") } : { status: "passed" }) }));
    assert.equal(calls, 2);
    assert.deepEqual([run.outcomes[0].screens[0].status, run.outcomes[0].screens[0].message], ["passed", `다시 돌려 통과 (첫 시도: ${slow("s1")})`]);
    assert.equal(statusOf(run, "A"), "passed");
  }

  // 기기·연결 → 기기·연결: 드라이버를 새로 열고, 점검 못 함
  {
    const { counter, openDriver } = countingOpen();
    const run = await runDevices(request, deps([device("A")], {}, { ...quiet, openDriver, scenarios: [scenario("s1")], checkScreen: async () => ({ status: "failed", message: lost }) }));
    assert.equal(counter.opened, 2);
    assert.equal(run.outcomes[0].screens[0].status, "inconclusive");
  }

  // 앱 실패 → 기기·연결: 실패, 메시지·묶음은 첫 시도 것
  {
    const writes: string[] = [];
    let calls = 0;
    const run = await runDevices(request, deps([device("A")], {}, {
      ...quiet,
      scenarios: [scenario("s1")],
      writeBundle: async (_dir, input) => void writes.push(input.screenshot.toString()),
      checkScreen: async () => (calls++ === 0 ? { status: "failed", message: slow("s1"), screenshot: Buffer.from("first") } : { status: "failed", message: lost, screenshot: Buffer.from("second") }),
    }));
    const screen = run.outcomes[0].screens[0];
    assert.deepEqual([screen.status, screen.message], ["failed", slow("s1")]);
    assert.deepEqual(writes, ["first"]);
    assert.ok(screen.logDir);
  }

  // 앱 실패 → 로그인 화면: 로그인 필요, 뒤 시나리오 안 돎
  {
    const fake = deps([device("A")], {}, { ...quiet, scenarios: [scenario("s1"), scenario("s2")] });
    fake.checkScreen = (() => {
      const inner = sequence({ s1: [{ status: "failed", message: slow("s1") }, { status: "login_required" }] });
      return async (d: ScreenDriver, t: Device, item: ScreenScenario) => (fake.checked.push(item.name), inner(d, t, item));
    })();
    const run = await runDevices(request, fake);
    assert.deepEqual(fake.checked, ["s1", "s1"]);
    assert.deepEqual(run.outcomes[0].screens.map((screen) => screen.status), ["login_required"]);
  }

  // 플로우: 다시 돌려도 실패하고 로그인 화면이면 로그인 필요, 뒤 플로우 안 돎
  {
    const flow = (name: string) => ({ id: name, name, source: "recorded" as const, status: "ready" as const, prd: "p", requirement: "r", steps: [] });
    const ran: string[] = [];
    let where = "/my";
    const loginDriver: ScreenDriver = { ...driver, currentPath: async () => where };
    const run = await runDevices({ ...request, flowsOnly: true }, deps([device("A")], {}, {
      ...quiet,
      openDriver: async () => loginDriver,
      flows: [flow("f1"), flow("f2")],
      runFlow: async (_target, item) => {
        ran.push(item.name);
        if (ran.length === 2) where = "/login";
        return { status: "failed", steps: [], message: "2단계 누르기 「확인」 실패: \"확인\" 버튼을 찾지 못했습니다." };
      },
    }));
    assert.deepEqual(ran, ["f1", "f1"]);
    assert.deepEqual(run.outcomes[0].screens.map((screen) => screen.status), ["login_required"]);
  }

  // 기준 화면 차이·retry false 플로우는 한 번만
  {
    const fake = deps([device("A")], { A: {} }, { ...quiet, scenarios: [scenario("s1")], checkScreen: async (_d, _t, item) => (fake.checked.push(item.name), { status: "failed", message: diffMessage }) });
    let flowRuns = 0;
    fake.flows = [{ id: "ad", name: "ad", source: "recorded", status: "ready", prd: "p", requirement: "r", steps: [], retry: false }];
    fake.runFlow = async () => (flowRuns++, { status: "failed", steps: [], message: "광고 적립이 안 됐습니다" });
    await runDevices(request, fake);
    assert.deepEqual(fake.checked, ["s1"]);
    assert.equal(flowRuns, 1);
  }

  // 망가진 빌드: 다시 돌리기는 기기당 10번까지
  {
    const many = Array.from({ length: 12 }, (_, index) => scenario(`m${index}`));
    const fake = deps([device("A")], {}, { ...quiet, scenarios: many });
    fake.checkScreen = async (_d, _t, item) => (fake.checked.push(item.name), { status: "failed", message: slow(item.name) });
    const run = await runDevices(request, fake);
    assert.equal(fake.checked.length, 22);
    assert.ok(run.outcomes[0].screens.every((screen) => screen.status === "failed"));
  }

  // 기기·연결이 3번 연속 확정되면 남은 점검(시나리오·플로우·데이터)을 건너뛴다
  {
    const five = Array.from({ length: 5 }, (_, index) => scenario(`c${index}`));
    const flowsRan: string[] = [];
    const qaRan: string[] = [];
    const fake = deps([device("A")], {}, {
      ...quiet,
      scenarios: five,
      flows: [{ id: "f", name: "f", source: "recorded", status: "ready", prd: "p", requirement: "r", steps: [] }],
      runFlow: async (_d, item) => (flowsRan.push(item.name), { status: "passed", steps: [] }),
      qaScreens: [{ path: "/q", name: "q", apis: {}, rules: [] }],
      runQa: async (_d, item) => (qaRan.push(item.name), { path: item.path, name: item.name, apis: [], checks: [] }),
    });
    fake.checkScreen = async (_d, _t, item) => (fake.checked.push(item.name), { status: "failed", message: lost });
    const run = await runDevices(request, fake);
    assert.deepEqual(fake.checked, ["c0", "c0", "c1", "c1", "c2", "c2"]);
    assert.deepEqual(flowsRan, []);
    assert.deepEqual(qaRan, []);
    const screens = run.outcomes[0].screens;
    assert.deepEqual(screens.map((screen) => [screen.scenario, screen.status]), [
      ["c0", "inconclusive"], ["c1", "inconclusive"], ["c2", "inconclusive"], ["c3", "inconclusive"], ["c4", "inconclusive"], ["플로우 점검 · f", "inconclusive"],
    ]);
    assert.equal(screens[3].message, "기기 연결이 계속 끊겨 남은 점검을 건너뜀");
  }
}

// ── 최종 리뷰 수정 ──
{
  const lost = "WebDriverError: A session is either terminated or not started";
  const quiet = { capture: async () => ({ ring: new LogRing(), frames: () => [], stop: async () => undefined }), resultsRoot: mkdtempSync(path.join(tmpdir(), "farm-review-")) };
  const flow = (name: string, extra: Record<string, unknown> = {}) => ({ id: name, name, source: "recorded" as const, status: "ready" as const, prd: "p", requirement: "r", steps: [], ...extra });

  // 다시 열기가 실패해도 기기 전체가 throw로 끝나지 않는다: 지금 화면은 첫 결과로, 남은 것은 건너뜀으로 남긴다
  {
    let opened = 0;
    const fake = deps([device("A")], {}, {
      ...quiet,
      scenarios: [scenario("s1"), scenario("s2")],
      openDriver: async () => {
        if (opened++ > 0) throw new Error("CDP 연결을 만들지 못했습니다");
        return driver;
      },
    });
    fake.checkScreen = async (_d, _t, item) => (fake.checked.push(item.name), { status: "failed", message: lost });
    const run = await runDevices(request, fake);
    assert.deepEqual(fake.checked, ["s1"]);
    assert.deepEqual(run.outcomes[0].screens.map((screen) => [screen.scenario, screen.status, screen.message]), [
      ["s1", "inconclusive", lost],
      ["s2", "inconclusive", "기기 연결이 계속 끊겨 남은 점검을 건너뜀"],
    ]);
    assert.equal(statusOf(run, "A"), "passed");
  }

  // 플로우가 「홈에서 시작」에서 3번 연속 실패하면 남은 플로우를 건너뛴다
  {
    const home = "1단계 홈에서 시작 「홈」 실패: \"홈\" 링크를 찾지 못했습니다.";
    const five = ["h0", "h1", "h2", "h3", "h4"].map((name) => flow(name));
    // 시작할 때는 정상이었다가 점검 중에 죽은 서버
    const downAfterStart = (reason: string) => {
      let calls = 0;
      return async (kind: string) => (assert.equal(kind, request.kind), calls++ === 0 ? null : reason);
    };
    // 2단계부터 실패해도(홈은 열림) 서버 탓이 3번 이어지면 남은 것은 서버 이유로 건너뛴다
    {
      const ran: string[] = [];
      const run = await runDevices({ ...request, flowsOnly: true }, deps([device("A")], {}, {
        ...quiet,
        flows: five,
        runFlow: async (_target, item) => (ran.push(item.name), { status: "failed" as const, steps: [], message: "2단계 누르기 「혜택」 실패: 이동 안 함" }),
        serverHealth: downAfterStart("HTTP 502"),
      }));
      assert.equal(new Set(ran).size, 3);
      assert.equal(run.outcomes[0].screens.length, 5);
      assert.ok(run.outcomes[0].screens.every((screen) => screen.status === "inconclusive"));
      assert.equal(run.outcomes[0].screens[4].message, "앱 웹 서버가 정상 응답하지 않아(HTTP 502) 남은 플로우를 건너뜀");
    }
    // 시작할 때 서버가 죽어 있으면 아무것도 돌지 않고 전부 점검 못 함으로 남긴다
    {
      const ran: string[] = [];
      const run = await runDevices(request, deps([device("A")], {}, {
        ...quiet,
        flows: [flow("h0")],
        openDriver: async () => (ran.push("open"), driver),
        serverHealth: async () => "HTTP 502",
        serverStartWaitMs: 0,
      }));
      assert.deepEqual(ran, []);
      assert.deepEqual(run.outcomes[0].screens.map((screen) => screen.scenario), ["s1", "s2", "s3", "플로우 점검 · h0"]);
      assert.ok(run.outcomes[0].screens.every((screen) => screen.status === "inconclusive" && screen.message === "앱 웹 서버가 정상 응답하지 않아(HTTP 502) 점검을 시작하지 못함"));
    }
    // 점검기가 앱 요청을 막은 채 실패하면 점검 못 함. 광고 배너처럼 무관한 요청이면 앱 실패 그대로
    for (const [blockedPath, expected] of [["/v1/api/v1/ad-reward/nonce", "inconclusive"], ["/api/ads/banner-result", "failed"], ["https://ads.example.net/banner", "failed"]] as const) {
      let block: (path: string) => void = () => undefined;
      const run = await runDevices({ ...request, buttonCheck: true }, deps([device("A")], {}, {
        ...quiet,
        app: { ...sampleApp, guard: { ...sampleApp.guard, harmlessBlockedPatterns: [/^\/api\/ads\//] } },
        flows: [flow("ad")],
        buttonCheck: {
          // 풀어도 계속 막는 가드(오늘 사고와 같은 상황)
          guard: async (_target, onBlocked) => ((block = (path) => onBlocked({ method: "POST", path, reason: "unknown", at: 0 })), async () => undefined),
          probe: async () => [],
          checkButtons: async () => [],
        },
        runFlow: async () => (block(blockedPath), { status: "failed" as const, steps: [], message: "3단계 광고 보고 적립 「광고 시청」 실패: 잔액이 늘지 않았습니다." }),
      }));
      const last = run.outcomes[0].screens.at(-1);
      assert.equal(last?.status, expected, blockedPath);
      if (expected === "inconclusive") assert.match(last?.message ?? "", /^점검기가 막은 요청이 있어 판정하지 못함\(POST \/v1\/api\/v1\/ad-reward\/nonce\)/);
    }
    // 가드를 풀지 못했으면 플로우 전에 드라이버를 새로 연다
    {
      let opened = 0;
      await runDevices({ ...request, buttonCheck: true }, deps([device("A")], {}, {
        ...quiet,
        flows: [flow("ok")],
        openDriver: async () => (opened++, driver),
        buttonCheck: { guard: async () => async () => { throw new Error("closed"); }, probe: async () => [], checkButtons: async () => [] },
        runFlow: async () => ({ status: "passed" as const, steps: [] }),
      }));
      assert.equal(opened, 2);
    }
    const homeFails = async (_target: ScreenDriver, item: { name: string }) => ({ status: "failed" as const, steps: [], message: item.name === "ok" ? "2단계 누르기 「확인」 실패" : home });
    // 서버가 정상이면 앞 3개는 실패 그대로, 나머지는 건너뜀
    {
      const ran: string[] = [];
      let probes = 0;
      const run = await runDevices({ ...request, flowsOnly: true }, deps([device("A")], {}, {
        ...quiet,
        flows: five,
        runFlow: async (target, item) => (ran.push(item.name), homeFails(target, item)),
        serverHealth: async () => (probes++, null),
      }));
      assert.deepEqual(ran, ["h0", "h0", "h1", "h1", "h2", "h2"]);
      // 시작할 때 한 번 + 실패 3번
      assert.equal(probes, 4);
      assert.deepEqual(run.outcomes[0].screens.map((screen) => screen.status), ["failed", "failed", "failed", "inconclusive", "inconclusive"]);
      assert.equal(run.outcomes[0].screens[3].message, "앞 플로우 3개가 모두 1단계 「홈에서 시작」에서 실패해 남은 플로우를 건너뜀");
    }
    // 서버가 502면 앞 실패도 점검 못 함(슬랙에 앱 실패로 가지 않게), 남은 것은 서버 이유로 건너뜀
    {
      const run = await runDevices({ ...request, flowsOnly: true }, deps([device("A")], {}, {
        ...quiet,
        flows: five,
        runFlow: homeFails,
        serverHealth: downAfterStart("HTTP 502"),
      }));
      const screens = run.outcomes[0].screens;
      assert.ok(screens.every((screen) => screen.status === "inconclusive"));
      assert.equal(screens[0].message, `앱 웹 서버가 정상 응답하지 않음(HTTP 502) · ${home}`);
      assert.equal(screens[4].message, "앱 웹 서버가 정상 응답하지 않아(HTTP 502) 남은 플로우를 건너뜀");
    }
    // 홈은 열렸는데 뒤 단계에서 실패해도 서버(API)가 멈췄으면 점검 못 함
    {
      const later = "2단계 누르기 「혜택」 실패: 「혜택」 링크를 눌렀지만 /benefit로 가지 않았습니다.";
      const run = await runDevices({ ...request, flowsOnly: true }, deps([device("A")], {}, {
        ...quiet,
        flows: [flow("l0")],
        runFlow: async () => ({ status: "failed" as const, steps: [], message: later }),
        serverHealth: downAfterStart("API 접속 실패: 10초 안에 응답 없음"),
      }));
      assert.equal(run.outcomes[0].screens[0].status, "inconclusive");
      assert.equal(run.outcomes[0].screens[0].message, `앱 웹 서버가 정상 응답하지 않음(API 접속 실패: 10초 안에 응답 없음) · ${later}`);
      // 서버가 정상이면 앱 실패 그대로
      const ok = await runDevices({ ...request, flowsOnly: true }, deps([device("A")], {}, {
        ...quiet,
        flows: [flow("l0")],
        runFlow: async () => ({ status: "failed" as const, steps: [], message: later }),
        serverHealth: async () => null,
      }));
      assert.equal(ok.outcomes[0].screens[0].status, "failed");
    }
    // 홈 실패가 연속이 아니면(중간에 다른 실패) 세지 않는다
    {
      const ran: string[] = [];
      await runDevices({ ...request, flowsOnly: true }, deps([device("A")], {}, {
        ...quiet,
        flows: [flow("h0"), flow("h1"), flow("ok"), flow("h2"), flow("h3")],
        runFlow: async (target, item) => (ran.push(item.name), homeFails(target, item)),
      }));
      assert.deepEqual([...new Set(ran)], ["h0", "h1", "ok", "h2", "h3"]);
    }
  }

  // 플로우 첫 시도가 로그인 화면에서 실패해도 다시 돈다. retry false면 로그인 판정 없이 실패
  {
    const ran: string[] = [];
    const atLogin: ScreenDriver = { ...driver, currentPath: async () => "/login" };
    const run = await runDevices({ ...request, flowsOnly: true }, deps([device("A")], {}, {
      ...quiet,
      openDriver: async () => atLogin,
      flows: [flow("once", { retry: false }), flow("f1")],
      runFlow: async (_target, item) => (ran.push(item.name), { status: "failed", steps: [], message: "1단계 누르기 「확인」 실패" }),
    }));
    assert.deepEqual(ran, ["once", "f1", "f1"]);
    assert.deepEqual(run.outcomes[0].screens.map((screen) => screen.status), ["failed", "login_required"]);
  }

  // 멈추면 다시 돌지 않는다
  {
    const abort = new AbortController();
    let calls = 0;
    await runDevices(request, deps([device("A")], {}, {
      ...quiet,
      signal: abort.signal,
      scenarios: [scenario("s1")],
      checkScreen: async () => {
        calls++;
        abort.abort();
        return { status: "failed", message: "/s1 화면이 15초 안에 그려지지 않았습니다." };
      },
    }));
    assert.equal(calls, 1);
  }
}

console.log("run ok");

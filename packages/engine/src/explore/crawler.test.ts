import assert from "node:assert/strict";

import type { ScreenDriver } from "@device-farm/core/device/driver";
import { linkClickScript, listActionsScript } from "@device-farm/core/explore/actions";
import type { ActionCandidate, ExploreAction, ExploreRun } from "@device-farm/core/explore/actions";
import type { BlockedRequest } from "@device-farm/core/explore/guard";

import { crawl, exploreLimits, listActions, replay, screenKey, selectActions } from "./crawler";
import { sampleApp } from "@device-farm/core/config/sample-app";

interface FakeScreen {
  buttons?: Record<string, string>;
  links?: Record<string, string>;
  inputs?: string[];
  external?: boolean;
  /** 이 화면에 들어올 때 가드가 막는 요청 */
  blocks?: boolean;
}

type Graph = Record<string, FakeScreen>;

function fakeDevice(graph: Graph) {
  let current = "/";
  const fills: string[] = [];
  const blocked: BlockedRequest[] = [];
  const probes = new Map<string, number>();
  const screen = () => graph[current];
  const go = (to: string) => {
    current = to;
    if (graph[to].blocks) blocked.push({ method: "POST", path: "/api/x", reason: "unknown", at: 0 });
  };
  const candidates = (): ActionCandidate[] => [
    ...Object.keys(screen().buttons ?? {}).map((name) => ({ role: "button" as const, name })),
    ...Object.keys(screen().links ?? {}).map((name) => ({ role: "link" as const, name })),
    ...(screen().inputs ?? []).map((name) => ({ role: "input" as const, name })),
  ];
  const fail = async (): Promise<never> => {
    throw new Error("not used");
  };
  const evaluate = async (script: string): Promise<unknown> => {
    if (script === listActionsScript) return candidates();
    const link = Object.entries(screen().links ?? {}).find(([name]) => script === linkClickScript(name));
    if (link) return go(link[1]);
    const input = (screen().inputs ?? []).find((label) => script.includes(`labelOf(el) === ${JSON.stringify(label)}`));
    if (input) return void fills.push(input);
    throw new Error("unknown script");
  };
  const driver: ScreenDriver = {
    app: sampleApp,
    navigate: async (path) => go(path),
    clickButton: async (name) => {
      const to = screen().buttons?.[name];
      if (!to) throw new Error(`버튼 없음: ${name}`);
      go(to);
    },
    expectText: fail,
    screenshot: fail,
    close: async () => undefined,
    currentPath: async () => current,
    hasText: async () => false,
    evaluate: evaluate as ScreenDriver["evaluate"],
  };
  return {
    driver,
    fills,
    probes,
    probe: async () => {
      probes.set(current, (probes.get(current) ?? 0) + 1);
      return current === "/b" ? [{ kind: "console" as const, message: "boom" }] : [];
    },
    isExternal: async () => screen().external === true,
    blockedSince: () => blocked.splice(0),
  };
}

const clickDepth = (actions: readonly ExploreAction[]) => actions.filter((action) => action.kind === "click").length;

// A → B → A 순환, 금지 버튼, 외부 화면, 차단 요청
const graph: Graph = {
  "/": { buttons: { "B로 가기": "/b", 매도하기: "/sell", "배송신청": "/sell" }, inputs: ["이름", "메모"] },
  "/b": { links: { 홈: "/", "외부 이동": "ext" }, blocks: true },
  "/sell": {},
  ext: { external: true, buttons: { 확인: "/c" } },
  "/c": {},
};
const device = fakeDevice(graph);
const steps: ExploreRun[] = [];
const run = await crawl({
  driver: device.driver,
  probe: device.probe,
  onStep: (step) => steps.push(step),
  formValues: { 이름: "테스트봇" },
  isExternal: device.isExternal,
  blockedSince: device.blockedSince,
  runId: "r1",
  deviceId: "d1",
  settleMs: 0,
});

assert.deepEqual(Object.fromEntries(device.probes), { "/": 1, "/b": 1 });
assert.equal(run.paths.length, 4); // 홈, B, B→홈(이미 봄), B→외부 이동(외부)
assert.ok(run.paths.every((path) => !path.actions.some((action) => action.kind === "click" && action.name === "매도하기")));
assert.deepEqual(run.paths[1].actions, [
  { kind: "fill", label: "이름", value: "테스트봇" },
  { kind: "click", role: "button", name: "B로 가기" },
]);
assert.ok(device.fills.includes("이름"));
assert.equal(device.fills.includes("메모"), false);
const externalPath = run.paths.find((path) => path.actions.some((action) => action.kind === "click" && action.name === "외부 이동"));
assert.ok(externalPath);
assert.equal(run.paths.some((path) => path.actions.length > externalPath.actions.length), false); // 외부 화면 자식 없음
assert.deepEqual(run.cleanPathIds, [run.paths[0].id]); // B를 지나는 경로는 차단이 있어 빠진다
assert.ok(run.blocked.length >= 1 && run.blocked.every((request) => request.pathId !== run.paths[0].id));
assert.deepEqual(run.issues, [{ kind: "console", message: "boom", pathId: run.paths[1].id, screenshot: "", logDir: "" }]);
assert.equal(run.runId, "r1");
assert.ok(run.finishedAt);
assert.ok(steps.length > 0);

// listActions: 금지 단어(띄어쓰기 무시) 제외, 이름 순
const home = fakeDevice(graph);
assert.deepEqual(await listActions(home.driver, { 이름: "테스트봇" }), [
  { kind: "click", role: "button", name: "B로 가기" },
  { kind: "fill", label: "이름", value: "테스트봇" },
]);
const many: ActionCandidate[] = Array.from({ length: 25 }, (_, index) => ({ role: "button", name: `버튼${String(index).padStart(2, "0")}` }));
const forbidden = sampleApp.guard.forbiddenButtonWords;
const selected = selectActions([...many].reverse(), {}, forbidden);
assert.equal(selected.length, exploreLimits.maxActionsPerScreen);
assert.equal(selected[0].kind === "click" && selected[0].name, "버튼00");
assert.equal(screenKey("/", selected), screenKey("/", selectActions(many, {}, forbidden)));
assert.notEqual(screenKey("/", selected), screenKey("/b", selected));
assert.match(screenKey("/", selected), /^[0-9a-f]{16}$/);

// maxDepth 넘는 경로 없음
const chain: Graph = { "/": { buttons: { 다음: "/s1" } } };
for (let index = 1; index <= 10; index += 1) chain[`/s${index}`] = { buttons: { 다음: `/s${index + 1}` } };
chain["/s11"] = {};
const deep = fakeDevice(chain);
const deepRun = await crawl({ driver: deep.driver, probe: deep.probe, onStep: () => undefined, formValues: {}, isExternal: deep.isExternal, settleMs: 0 });
assert.equal(Math.max(...deepRun.paths.map((path) => clickDepth(path.actions))), exploreLimits.maxDepth);
assert.equal(deep.probes.size, exploreLimits.maxDepth + 1);

// 가짜 시계로 maxMinutes 넘기면 멈추고 finishedAt 채움
let clock = 0;
const slow = fakeDevice(chain);
const slowRun = await crawl({
  driver: slow.driver,
  probe: slow.probe,
  onStep: () => undefined,
  formValues: {},
  isExternal: slow.isExternal,
  now: () => (clock += 10 * 60_000),
  settleMs: 0,
});
assert.ok(slowRun.paths.length < deepRun.paths.length);
assert.ok(slowRun.finishedAt);
assert.ok(Date.parse(slowRun.finishedAt) - Date.parse(slowRun.startedAt) > exploreLimits.maxMinutes * 60_000);

// 재생 실패는 throw, crawl에서는 replayFailures로 남고 clean에서 빠진다
await assert.rejects(replay(fakeDevice(graph).driver, { id: "x", actions: [{ kind: "click", role: "button", name: "없는 버튼" }] }, 0));
const vanishing: Graph = { "/": { buttons: { 사라짐: "/gone" } }, "/gone": {} };
const vanish = fakeDevice(vanishing);
const brokenDriver: ScreenDriver = { ...vanish.driver, clickButton: async () => { throw new Error("버튼 없음"); } };
const failedRun = await crawl({ driver: brokenDriver, probe: vanish.probe, onStep: () => undefined, formValues: {}, isExternal: vanish.isExternal, settleMs: 0 });
assert.equal(failedRun.replayFailures.length, 1);
assert.equal(failedRun.cleanPathIds.includes(failedRun.replayFailures[0].pathId), false);

console.log("crawler ok");

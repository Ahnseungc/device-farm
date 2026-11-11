import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  adhocWaitMs,
  createReleaseWatcher,
  newestUnseen,
  seenFile,
  targetKey,
  watchTargets,
  type Signal,
  type WatchDeps,
  type WatchTarget,
} from "./watch";

const androidDev = watchTargets[0];
const iosProd = watchTargets[3];

function signal(target: WatchTarget, version: string): Signal {
  return { target, id: `${targetKey(target)}-${version}`, version };
}

interface Harness {
  deps: WatchDeps;
  lists: Map<string, Signal[] | Error>;
  runs: Signal[];
  failures: { signal: Signal; message: string }[];
  adhocVersions: Set<string>;
  clock: { now: number };
  gate: { hold: Promise<void> | null; started: (() => void) | null };
}

function harness(root: string): Harness {
  const lists = new Map<string, Signal[] | Error>(
    watchTargets.map((target) => [targetKey(target), [signal(target, "1.0.0+1")]]),
  );
  const runs: Signal[] = [];
  const failures: { signal: Signal; message: string }[] = [];
  const adhocVersions = new Set<string>();
  const clock = { now: 0 };
  const gate: Harness["gate"] = { hold: null, started: null };
  const deps: WatchDeps = {
    listSignals: async (target) => {
      const value = lists.get(targetKey(target)) ?? [];
      if (value instanceof Error) throw value;
      return value;
    },
    isBusy: () => false,
    startRun: async (run) => {
      runs.push(run);
      gate.started?.();
      if (gate.hold) await gate.hold;
    },
    findAdhoc: async (run) => adhocVersions.has(run.version),
    failIos: async (run, message) => {
      failures.push({ signal: run, message });
    },
    now: () => clock.now,
    root,
    log: () => {},
  };
  return { deps, lists, runs, failures, adhocVersions, clock, gate };
}

async function readSeenFile(root: string): Promise<Record<string, string>> {
  return JSON.parse(await readFile(path.join(root, seenFile), "utf8"));
}

// newestUnseen
assert.equal(newestUnseen([], null), null);
assert.equal(newestUnseen([{ id: "b" }, { id: "a" }], "b"), null);
assert.deepEqual(newestUnseen([{ id: "b" }, { id: "a" }], "a"), { id: "b" });

const root = await mkdtemp(path.join(tmpdir(), "device-farm-watch-"));
const h = harness(root);
const watcher = createReleaseWatcher(h.deps);

// 첫 시작: 돌지 않고 대상마다 최신을 적는다
await watcher.tick();
assert.equal(h.runs.length, 0);
assert.deepEqual(
  await readSeenFile(root),
  Object.fromEntries(watchTargets.map((target) => [targetKey(target), `${targetKey(target)}-1.0.0+1`])),
);

// 새 신호 하나 → 1회, 다음 회차 같은 목록 → 추가 없음
h.lists.set(targetKey(androidDev), [signal(androidDev, "1.0.1+2"), signal(androidDev, "1.0.0+1")]);
await watcher.tick();
await watcher.tick();
assert.deepEqual(h.runs.map((run) => run.version), ["1.0.1+2"]);

// 점검 중 새 신호 둘이 차례로 → 끝난 뒤 가장 최근 것 하나만
let release = () => {};
h.gate.hold = new Promise<void>((resolve) => (release = resolve));
const started = new Promise<void>((resolve) => (h.gate.started = resolve));
h.lists.set(targetKey(androidDev), [signal(androidDev, "1.0.2+3")]);
const busyTick = watcher.tick();
await started;
h.gate.started = null;
h.gate.hold = null;
h.lists.set(targetKey(androidDev), [signal(androidDev, "1.0.3+4")]);
await watcher.tick();
h.lists.set(targetKey(androidDev), [signal(androidDev, "1.0.4+5")]);
await watcher.tick();
assert.deepEqual(h.runs.map((run) => run.version), ["1.0.1+2", "1.0.2+3"]);
release();
await busyTick;
assert.deepEqual(h.runs.map((run) => run.version), ["1.0.1+2", "1.0.2+3", "1.0.4+5"]);

// 바쁜 동안은 꺼내지 않는다
let busy = true;
const busyHarness = { ...h.deps, isBusy: () => busy };
const busyWatcher = createReleaseWatcher(busyHarness);
h.lists.set(targetKey(androidDev), [signal(androidDev, "1.0.5+6")]);
await busyWatcher.tick();
assert.equal(h.runs.length, 3);
busy = false;
await busyWatcher.tick();
assert.equal(h.runs.at(-1)?.version, "1.0.5+6");

// 본 기록을 남기고 재시작 → 같은 신호를 다시 넣지 않음
const runsBeforeRestart = h.runs.length;
await createReleaseWatcher(h.deps).tick();
assert.equal(h.runs.length, runsBeforeRestart);

// 목록 읽기 reject → 그 회차 건너뜀, 본 기록 그대로
const seenBefore = await readSeenFile(root);
h.lists.set(targetKey(androidDev), new Error("network down"));
await watcher.tick();
assert.deepEqual(await readSeenFile(root), seenBefore);
assert.equal(h.runs.length, runsBeforeRestart);
h.lists.set(targetKey(androidDev), [signal(androidDev, "1.0.5+6")]);

// TestFlight 2.1.5+412, Firebase엔 2.1.5+411만 → 설치 안 함, adhocWaitMs + 1 뒤 install_failed
h.adhocVersions.add("2.1.5+411");
h.lists.set(targetKey(iosProd), [signal(iosProd, "2.1.5+412")]);
await watcher.tick();
h.clock.now = adhocWaitMs;
await watcher.tick();
assert.equal(h.runs.length, runsBeforeRestart);
assert.equal(h.failures.length, 0);
h.clock.now = adhocWaitMs + 1;
await watcher.tick();
assert.equal(h.runs.length, runsBeforeRestart);
assert.deepEqual(h.failures, [
  { signal: signal(iosProd, "2.1.5+412"), message: "2.1.5+412 TestFlight 빌드와 같은 Ad-hoc이 Firebase에 없습니다." },
]);
await watcher.tick();
assert.equal(h.failures.length, 1);

// 같은 버전 Ad-hoc이 올라오면 그 신호로 돈다
h.adhocVersions.add("2.1.6+420");
h.lists.set(targetKey(iosProd), [signal(iosProd, "2.1.6+420")]);
await watcher.tick();
assert.equal(h.runs.at(-1)?.version, "2.1.6+420");

// 빈 목록으로 시작 → 다음 회차 첫 릴리스 실행
const emptyRoot = await mkdtemp(path.join(tmpdir(), "device-farm-watch-empty-"));
const empty = harness(emptyRoot);
empty.lists.set(targetKey(androidDev), []);
const emptyWatcher = createReleaseWatcher(empty.deps);
await emptyWatcher.tick();
assert.equal((await readSeenFile(emptyRoot))[targetKey(androidDev)], "");
assert.equal(empty.runs.length, 0);
empty.lists.set(targetKey(androidDev), [signal(androidDev, "1.0.0+1")]);
await emptyWatcher.tick();
assert.deepEqual(empty.runs.map((run) => run.version), ["1.0.0+1"]);

// 첫 회차 읽기 실패 대상은 기록하지 않고, 다음 회차에 최신을 적기만 한다
const failRoot = await mkdtemp(path.join(tmpdir(), "device-farm-watch-fail-"));
const failing = harness(failRoot);
failing.lists.set(targetKey(androidDev), new Error("network down"));
const failingWatcher = createReleaseWatcher(failing.deps);
await failingWatcher.tick();
assert.equal(targetKey(androidDev) in (await readSeenFile(failRoot)), false);
failing.lists.set(targetKey(androidDev), [signal(androidDev, "1.0.0+1")]);
await failingWatcher.tick();
assert.equal(failing.runs.length, 0);

await rm(emptyRoot, { recursive: true, force: true });
await rm(failRoot, { recursive: true, force: true });
await rm(root, { recursive: true, force: true });
console.log("watch ok");

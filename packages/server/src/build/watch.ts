import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { BuildKind, Platform } from "@device-farm/core/device/types";

import type { Release } from "./firebase";
import type { TestflightBuild } from "./testflight";

export const releasePollMs = 5 * 60_000;
export const adhocWaitMs = 60 * 60_000;
export const seenFile = "test-results/devices/seen-releases.json";
/** 첫 회차에 목록이 비어 있던 대상의 본 기록 값. */
export const emptySeen = "";

export type WatchTarget = { platform: Platform; kind: BuildKind };
/** `version` = `<표시 버전>+<빌드 번호>` */
export type Signal = { target: WatchTarget; id: string; version: string };

export const watchTargets = [
  { platform: "android", kind: "dev" },
  { platform: "android", kind: "prod" },
  { platform: "ios", kind: "dev" },
  { platform: "ios", kind: "prod" },
] as const satisfies readonly WatchTarget[];

type SeenRecord = Record<string, string>;
type PendingEntry = { signal: Signal; since: number };

export interface WatchDeps {
  /** 최신 순. iOS 운영은 TestFlight, 나머지는 Firebase 릴리스. */
  listSignals: (target: WatchTarget) => Promise<Signal[]>;
  /** 수동 점검 등으로 기기가 쓰이는 중이면 true. */
  isBusy: () => boolean;
  /** 호출부가 `runDevices({ ..., trigger: "auto" })`로 잇는다. */
  startRun: (signal: Signal) => Promise<void>;
  /** iOS 운영: Firebase 운영 iOS에 같은 version+build Ad-hoc이 있으면 true. */
  findAdhoc: (signal: Signal) => Promise<boolean>;
  /** iOS 기기를 `install_failed`로 닫는다. */
  failIos: (signal: Signal, message: string) => Promise<void>;
  now?: () => number;
  root?: string;
  log?: (message: string) => void;
}

export interface ReleaseWatcher {
  tick: () => Promise<void>;
}

export function targetKey(target: WatchTarget): string {
  return `${target.platform}-${target.kind}`;
}

/** `items`는 최신 순. 가장 최근 항목이 `seen`과 다르면 그것. */
export function newestUnseen<T extends { id: string }>(items: readonly T[], seen: string | null): T | null {
  const newest = items[0];
  return newest && newest.id !== seen ? newest : null;
}

export function releaseSignals(target: WatchTarget, releases: readonly Release[]): Signal[] {
  return [...releases]
    .sort((a, b) => Date.parse(b.createTime) - Date.parse(a.createTime))
    .map((release) => ({ target, id: release.name, version: `${release.displayVersion}+${release.buildVersion}` }));
}

export function testflightSignals(target: WatchTarget, builds: readonly TestflightBuild[]): Signal[] {
  return builds.map((build) => ({ target, id: build.id, version: `${build.version}+${build.build}` }));
}

export function adhocMissingMessage(version: string): string {
  return `${version} TestFlight 빌드와 같은 Ad-hoc이 Firebase에 없습니다.`;
}

function isIosProd(target: WatchTarget): boolean {
  return target.platform === "ios" && target.kind === "prod";
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseSeen(text: string): SeenRecord {
  const value: unknown = JSON.parse(text);
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

async function readSeen(filePath: string, log: (message: string) => void): Promise<SeenRecord> {
  try {
    return parseSeen(await readFile(filePath, "utf8"));
  } catch (error) {
    const missing = error instanceof Error && "code" in error && error.code === "ENOENT";
    // 깨진 파일은 첫 시작처럼 다시 적는다. 쌓인 빌드를 돌지 않는 쪽이 안전하다.
    if (!missing) log(`본 기록을 읽지 못해 새로 적습니다: ${errorText(error)}`);
    return {};
  }
}

async function writeSeen(filePath: string, seen: SeenRecord): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(seen, null, 2)}\n`);
}

export function createReleaseWatcher(deps: WatchDeps): ReleaseWatcher {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? ((message: string) => console.log(`[watch] ${message}`));
  const seenPath = path.join(deps.root ?? process.cwd(), seenFile);
  const pending = new Map<string, PendingEntry>();
  let polling = false;
  let draining = false;

  async function listAll(): Promise<PromiseSettledResult<Signal[]>[]> {
    return Promise.allSettled(watchTargets.map((target) => deps.listSignals(target)));
  }

  /** 본 적 없는 대상(첫 시작)은 최신을 적기만 하고, 아니면 새 신호를 대기열에 둔다. */
  function observe(record: SeenRecord, target: WatchTarget, signals: Signal[]): boolean {
    const key = targetKey(target);
    const known = record[key];
    const newest = newestUnseen(signals, known ?? null);
    if (!newest) {
      // 읽기는 성공했지만 릴리스가 없으면 "본 것 없음"("")을 적어 다음 첫 릴리스가 돌게 한다.
      if (known !== undefined) return false;
      record[key] = emptySeen;
      return true;
    }
    record[key] = newest.id;
    if (known !== undefined) pending.set(key, { signal: newest, since: now() });
    return true;
  }

  async function poll(): Promise<void> {
    const current = await readSeen(seenPath, log);
    const results = await listAll();
    let changed = false;
    results.forEach((result, index) => {
      const target = watchTargets[index];
      if (result.status === "rejected") {
        log(`${targetKey(target)} 목록을 읽지 못해 이번 회차를 건너뜁니다: ${errorText(result.reason)}`);
        return;
      }
      changed = observe(current, target, result.value) || changed;
    });
    if (changed) await writeSeen(seenPath, current);
  }

  async function adhocReady(key: string, entry: PendingEntry): Promise<boolean> {
    if (!isIosProd(entry.signal.target)) return true;
    try {
      if (await deps.findAdhoc(entry.signal)) return true;
    } catch (error) {
      log(`${entry.signal.version} Ad-hoc 확인 실패: ${errorText(error)}`);
    }
    if (now() - entry.since <= adhocWaitMs) return false;
    pending.delete(key);
    await deps.failIos(entry.signal, adhocMissingMessage(entry.signal.version)).catch((error: unknown) => {
      log(`${entry.signal.version} install_failed 기록 실패: ${errorText(error)}`);
    });
    return false;
  }

  async function runNext(): Promise<boolean> {
    for (const [key, entry] of pending) {
      if (deps.isBusy()) return false;
      if (!(await adhocReady(key, entry))) continue;
      // adhocReady를 기다리는 동안 더 새 신호로 바뀌었으면 다음 바퀴에서 그것을 본다.
      if (pending.get(key) !== entry) return true;
      pending.delete(key);
      await deps.startRun(entry.signal).catch((error: unknown) => {
        log(`${key} ${entry.signal.version} 자동 점검 실패: ${errorText(error)}`);
      });
      return true;
    }
    return false;
  }

  async function drain(): Promise<void> {
    if (draining) return;
    draining = true;
    try {
      while (await runNext());
    } finally {
      draining = false;
    }
  }

  async function tick(): Promise<void> {
    if (!polling) {
      polling = true;
      try {
        await poll();
      } catch (error) {
        log(`감시 회차 실패: ${errorText(error)}`);
      } finally {
        polling = false;
      }
    }
    await drain();
  }

  return { tick };
}

/** 지금 한 번, 이후 `releasePollMs`마다 확인한다. 정지 함수를 돌려준다. */
export function startReleaseWatch(deps: WatchDeps, pollMs: number = releasePollMs): () => void {
  const watcher = createReleaseWatcher(deps);
  void watcher.tick();
  const timer = setInterval(() => void watcher.tick(), pollMs);
  return () => clearInterval(timer);
}

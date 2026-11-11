import { createHash } from "node:crypto";
import { setTimeout as wait } from "node:timers/promises";

import type { ScreenDriver } from "@device-farm/core/device/driver";
import { hasForbiddenWord, listActionsScript, linkClickScript, fillScript, type ActionCandidate, type ExploreAction, type ExploreIssue, type ExplorePath, type ExploreRun } from "@device-farm/core/explore/actions";
import type { BlockedRequest } from "@device-farm/core/explore/guard";
import type { Issue } from "@device-farm/core/explore/probe";

export const exploreLimits = { maxDepth: 6, maxActionsPerScreen: 20, maxMinutes: 30 } as const; // 작성자 판단

/** 동작 사이 화면 안정 대기(ms). */
export const actionSettleMs = 500;

const minuteMs = 60_000;
const hashLength = 16;

function toAction(candidate: ActionCandidate, formValues: Record<string, string>, forbiddenWords: readonly string[]): ExploreAction | null {
  if (candidate.role === "input") {
    const value = formValues[candidate.name];
    return value ? { kind: "fill", label: candidate.name, value } : null;
  }
  if (hasForbiddenWord(candidate.name, forbiddenWords)) return null;
  return { kind: "click", role: candidate.role, name: candidate.name };
}

function actionSortKey(action: ExploreAction): string {
  return action.kind === "fill" ? `${action.label}\u0000fill` : `${action.name}\u0000${action.role}`;
}

function compareActions(a: ExploreAction, b: ExploreAction): number {
  const left = actionSortKey(a);
  const right = actionSortKey(b);
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/** 이름 순 정렬(코드 단위 비교, 로캘 무관)·중복 제거·화면당 상한. */
export function selectActions(candidates: readonly ActionCandidate[], formValues: Record<string, string>, forbiddenWords: readonly string[]): ExploreAction[] {
  const unique = new Map<string, ExploreAction>();
  for (const candidate of candidates) {
    const action = toAction(candidate, formValues, forbiddenWords);
    if (action) unique.set(actionSortKey(action), action);
  }
  return [...unique.values()].sort(compareActions).slice(0, exploreLimits.maxActionsPerScreen);
}

export async function listActions(driver: ScreenDriver, formValues: Record<string, string>): Promise<ExploreAction[]> {
  const candidates = await driver.evaluate<ActionCandidate[]>(listActionsScript);
  return selectActions(candidates, formValues, driver.app.guard.forbiddenButtonWords);
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, hashLength);
}

export function screenKey(path: string, actions: readonly ExploreAction[]): string {
  return shortHash(JSON.stringify([path, actions]));
}

export function pathId(actions: readonly ExploreAction[]): string {
  return shortHash(JSON.stringify(actions));
}

async function runAction(driver: ScreenDriver, action: ExploreAction): Promise<void> {
  if (action.kind === "fill") {
    await driver.evaluate<boolean>(fillScript(action.label, action.value));
    return;
  }
  if (action.role === "button") {
    await driver.clickButton(action.name);
    return;
  }
  await driver.evaluate<boolean>(linkClickScript(action.name));
}

/** 홈에서 다시 시작해 동작을 차례로. 뒤로 가기에 기대지 않는다. */
export async function replay(driver: ScreenDriver, path: ExplorePath, settleMs = actionSettleMs): Promise<void> {
  await driver.navigate("/");
  for (const action of path.actions) {
    await runAction(driver, action);
    if (settleMs > 0) await wait(settleMs);
  }
}

export interface CrawlInput {
  driver: ScreenDriver;
  probe: () => Promise<Issue[]>;
  onStep: (run: ExploreRun) => void;
  now?: () => number;
  formValues: Record<string, string>;
  isExternal: () => Promise<boolean>;
  /** 직전 호출 이후 가드가 막은 요청을 꺼낸다(꺼내면 비운다). 없으면 막힌 요청이 없다고 본다. */
  blockedSince?: () => BlockedRequest[];
  runId?: string;
  deviceId?: string;
  settleMs?: number;
}

function clickDepth(actions: readonly ExploreAction[]): number {
  return actions.filter((action) => action.kind === "click").length;
}

/** 클릭마다 자식 하나. 그 화면의 입력은 클릭 앞에 모두 채운다(입력만으로는 화면이 안 바뀐다). */
function childPaths(path: ExplorePath, actions: readonly ExploreAction[]): ExplorePath[] {
  if (clickDepth(path.actions) >= exploreLimits.maxDepth) return [];
  const fills = actions.filter((action) => action.kind === "fill");
  return actions
    .filter((action) => action.kind === "click")
    .map((click) => {
      const next = [...path.actions, ...fills, click];
      return { id: pathId(next), actions: next };
    });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type Visit = { clean: boolean; children: ExplorePath[] };

async function visit(input: CrawlInput, run: ExploreRun, path: ExplorePath, seen: Set<string>): Promise<Visit> {
  const { driver } = input;
  try {
    await replay(driver, path, input.settleMs);
  } catch (error) {
    run.replayFailures.push({ pathId: path.id, message: errorMessage(error) });
    return { clean: false, children: [] };
  }
  // 외부 화면: 아무것도 누르지 않고 더 펼치지 않는다. 검사도 하지 않는다(우리 화면이 아님).
  if (await input.isExternal()) return { clean: true, children: [] };
  const actions = await listActions(driver, input.formValues);
  const key = screenKey(await driver.currentPath(), actions);
  // 이미 본 화면: 경로는 남기지만 다시 검사·전개하지 않고 iOS 재실행 대상에서도 뺀다.
  if (seen.has(key)) return { clean: false, children: [] };
  seen.add(key);
  const issues = await input.probe();
  run.issues.push(...issues.map((issue) => ({ ...issue, pathId: path.id, screenshot: "", logDir: "" })));
  return { clean: true, children: childPaths(path, actions) };
}

function takeBlocked(input: CrawlInput): BlockedRequest[] {
  return input.blockedSince ? input.blockedSince() : [];
}

/** 홈부터 너비 우선. 본 screenKey는 다시 펼치지 않는다. maxMinutes가 지나면 멈춘다. */
export async function crawl(input: CrawlInput): Promise<ExploreRun> {
  const now = input.now ?? Date.now;
  const startedAt = now();
  const deadline = startedAt + exploreLimits.maxMinutes * minuteMs;
  const run: ExploreRun = {
    runId: input.runId ?? "",
    deviceId: input.deviceId ?? "",
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: null,
    paths: [],
    issues: [],
    blocked: [],
    cleanPathIds: [],
    replayFailures: [],
  };
  const seen = new Set<string>();
  const queue: ExplorePath[] = [{ id: pathId([]), actions: [] }];
  takeBlocked(input); // 시작 전 쌓인 차단은 어느 경로 것도 아니다.
  while (queue.length > 0 && now() <= deadline) {
    const path = queue.shift();
    if (!path) break;
    const result = await visit(input, run, path, seen);
    const blocked = takeBlocked(input);
    run.paths.push(path);
    run.blocked.push(...blocked.map((request) => ({ ...request, pathId: path.id })));
    if (result.clean && blocked.length === 0) run.cleanPathIds.push(path.id);
    queue.push(...result.children);
    input.onStep(run);
  }
  run.finishedAt = new Date(now()).toISOString();
  input.onStep(run);
  return run;
}

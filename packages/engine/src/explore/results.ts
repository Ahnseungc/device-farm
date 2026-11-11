import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { Platform } from "@device-farm/core/device/types";
import type { ExplorePath, ExploreRun } from "@device-farm/core/explore/actions";

import { pathSegment, testResultsRoot } from "../run";

/** 스펙 밖 추가 필드: `platform`, 기기를 건너뛰었거나 탐색이 끊긴 이유 `message`. */
export type ExploreResult = ExploreRun & { platform: Platform; message?: string };

const exploreDir = "explore";
const jsonExtension = ".json";

export function exploreRunDir(runId: string, root = testResultsRoot): string {
  return path.join(root, exploreDir, pathSegment(runId));
}

/** `test-results/explore/<runId>/<deviceId>.json`. 임시 파일에 쓰고 rename한다. */
export function writeExploreResult(result: ExploreResult, root = testResultsRoot): void {
  const file = path.join(exploreRunDir(result.runId, root), `${pathSegment(result.deviceId)}${jsonExtension}`);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(`${file}.part`, JSON.stringify(result, null, 2));
  renameSync(`${file}.part`, file);
}

function isExploreResult(value: unknown): value is ExploreResult {
  if (typeof value !== "object" || value === null) return false;
  const run = value as Partial<ExploreResult>;
  return typeof run.runId === "string" && typeof run.platform === "string" && typeof run.deviceId === "string" && Array.isArray(run.paths) && Array.isArray(run.cleanPathIds);
}

function readResult(file: string): ExploreResult | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    return isExploreResult(parsed) ? parsed : null;
  } catch {
    // 쓰는 중이거나 깨진 파일은 목록에서 뺀다. 다음 읽기에서 다시 본다.
    return null;
  }
}

/** 한 실행의 기기별 결과. 없으면 빈 배열. */
export function readExploreRun(runId: string, root = testResultsRoot): ExploreResult[] {
  const dir = exploreRunDir(runId, root);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(jsonExtension))
    .sort()
    .flatMap((name) => readResult(path.join(dir, name)) ?? []);
}

/** runId가 시각으로 시작하므로 이름 순 마지막이 최신이다. */
export function readLatestExplore(root = testResultsRoot): ExploreResult[] {
  const base = path.join(root, exploreDir);
  if (!existsSync(base)) return [];
  const latest = readdirSync(base, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .at(-1);
  return latest ? readExploreRun(latest, root) : [];
}

/** Android 결과 중 차단 없이 끝난 경로. 끝난 Android 결과가 없으면 null. */
export function cleanAndroidPaths(results: readonly ExploreResult[]): ExplorePath[] | null {
  const crawled = results.filter((result) => result.platform === "android" && result.finishedAt !== null && result.message === undefined);
  if (crawled.length === 0) return null;
  const paths = new Map<string, ExplorePath>();
  for (const result of crawled) {
    const clean = new Set(result.cleanPathIds);
    for (const item of result.paths) if (clean.has(item.id) && !paths.has(item.id)) paths.set(item.id, item);
  }
  return [...paths.values()];
}

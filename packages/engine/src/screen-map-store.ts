import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { ButtonResult } from "@device-farm/core/device/button-check";
import { edgesFrom, mergeEdges, type ScreenMap } from "@device-farm/core/device/screen-map";

/** 화면 지도 파일. 계정 상태에 따라 달라지므로 커밋하지 않고 `test-results/`에 둔다. */
export const screenMapFile = path.resolve("test-results/screen-map.json");

export function readScreenMap(file = screenMapFile): ScreenMap {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as ScreenMap;
  } catch {
    // 아직 버튼 눌러보기를 돌리지 않았으면 파일이 없다. 빈 지도와 같다.
    return { edges: [] };
  }
}

/** 한 화면 결과를 지도 파일에 합친다. 임시 파일에 쓰고 바꿔 끼워 반쯤 쓴 파일을 남기지 않는다. */
export function recordScreenMap(from: string, results: readonly ButtonResult[], file = screenMapFile, now = new Date()): void {
  const edges = mergeEdges(readScreenMap(file).edges, edgesFrom(from, results, now.toISOString()));
  mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  writeFileSync(temp, `${JSON.stringify({ edges } satisfies ScreenMap, null, 2)}\n`);
  renameSync(temp, file);
}

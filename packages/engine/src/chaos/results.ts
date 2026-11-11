import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import type { ChaosRun, ChaosRunSummary } from "@device-farm/core/chaos/types";

/** 카오스 실행 기록 폴더. 실행마다 `<runId>/run.json`과 오류 스크린샷 */
export const chaosRoot = path.resolve("test-results/chaos");
/** 실행 id는 시각·시드로만 된다. 경로 탈출을 막는다. */
const runIdPattern = /^[0-9A-Za-z-]+$/;

export function readChaosRun(runId: string, root = chaosRoot): ChaosRun | null {
  if (!runIdPattern.test(runId)) return null;
  const file = path.join(root, runId, "run.json");
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as ChaosRun;
  } catch {
    // 쓰는 중에 읽으면 깨질 수 있다. 다음 폴링에서 다시 읽는다.
    return null;
  }
}

/** 최근 실행부터. 깨진 기록은 뺀다. */
export function listChaosRuns(root = chaosRoot): ChaosRunSummary[] {
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .flatMap((runId) => {
      const run = readChaosRun(runId, root);
      if (!run) return [];
      const summary: ChaosRunSummary = {
        runId: run.runId,
        deviceId: run.deviceId,
        seed: run.seed,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        steps: run.steps.length,
        states: run.states,
        errorSteps: run.steps.filter((step) => step.errors.length > 0).length,
        blocked: run.blocked.length,
      };
      return [summary];
    })
    .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
}

import { setTimeout as wait } from "node:timers/promises";

import type { ExploreRun } from "@device-farm/core/explore/actions";

import { CliError, isRecord, requestJson } from "./http";
import { parseExploreArgs } from "./args";
import {
  exitCodes,
  exploreExitCode,
  formatExploreRun,
  formatExploreSummary,
  isExploreFinished,
  summarizeExplore,
} from "./format";

const pollIntervalMs = 2000;

async function startExplore(port: number, body: object): Promise<string> {
  const result = await requestJson(port, "/api/devices/explore", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!isRecord(result) || typeof result.runId !== "string") throw new CliError("디바이스팜 서버가 runId를 주지 않았습니다.");
  return result.runId;
}

/** 서버 계약상 `ExploreRun[]`. 이 요청의 runId만 남긴다. */
async function readRuns(port: number, runId: string): Promise<ExploreRun[]> {
  const result = await requestJson(port, "/api/devices/explore/latest");
  if (!Array.isArray(result)) return [];
  return result.filter((run): run is ExploreRun => isRecord(run) && run.runId === runId);
}

/** 기기별 진행 줄은 바뀔 때만 찍는다. */
async function followExplore(port: number, runId: string): Promise<ExploreRun[]> {
  const printed = new Map<string, string>();
  for (;;) {
    const runs = await readRuns(port, runId);
    for (const run of runs) {
      const line = formatExploreRun(run);
      if (printed.get(run.deviceId) === line) continue;
      printed.set(run.deviceId, line);
      console.log(line);
    }
    if (isExploreFinished(runs)) return runs;
    await wait(pollIntervalMs);
  }
}

async function main(): Promise<number> {
  const args = parseExploreArgs(process.argv.slice(2));
  if (!args.ok) throw new CliError(args.error);
  const { devices, port, build } = args.value;
  const runId = await startExplore(port, build ? { devices, build } : { devices });
  console.log(`탐색 시작 (${runId})`);
  const runs = await followExplore(port, runId);
  console.log(formatExploreSummary(summarizeExplore(runs)));
  const code = exploreExitCode(runs);
  console.log(`exit ${code}`);
  return code;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = exitCodes.failed;
  });

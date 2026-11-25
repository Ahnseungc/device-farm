import { setTimeout as wait } from "node:timers/promises";

import type { DeviceRun } from "@device-farm/core/device/types";

import { CliError, isRecord, requestJson } from "./http";
import { parseRunArgs } from "./args";
import { changedLines, exitCodes, isRunFinished, noDevicesMessage, runExitCode } from "./format";
import type { PrintedState } from "./format";

const pollIntervalMs = 2000;

async function startRun(port: number, body: object): Promise<{ runId: string; position: number }> {
  const result = await requestJson(port, "/api/devices/run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!isRecord(result) || typeof result.runId !== "string") throw new CliError("디바이스팜 서버가 runId를 주지 않았습니다.");
  return { runId: result.runId, position: typeof result.position === "number" ? result.position : 0 };
}

/** 서버 계약상 `DeviceRun | null`. runId만 확인하고 나머지는 서버를 믿는다. */
async function readLatestRun(port: number): Promise<DeviceRun | null> {
  const result = await requestJson(port, "/api/devices/runs/latest");
  if (!isRecord(result) || typeof result.runId !== "string") return null;
  return result as unknown as DeviceRun;
}

/** 내 runId 실행만 따라간다. 아직 latest가 이전 실행이면 다음 폴링까지 기다린다. */
async function followRun(port: number, runId: string): Promise<DeviceRun> {
  const printed: PrintedState = new Map();
  for (;;) {
    const run = await readLatestRun(port);
    if (run?.runId === runId) {
      for (const line of changedLines(run, printed)) console.log(line);
      if (isRunFinished(run)) return run;
    }
    await wait(pollIntervalMs);
  }
}

async function main(): Promise<number> {
  const args = parseRunArgs(process.argv.slice(2));
  if (!args.ok) throw new CliError(args.error);
  const { kind, version, devices, port } = args.value;
  const { runId, position } = await startRun(port, { kind, version, devices });
  // 다른 점검이 돌고 있으면 서버 대기열에 들어간다. 차례가 오면 아래 followRun이 따라간다
  console.log(position > 0 ? `기기 점검 대기 ${position}번째 (${runId}) · ${kind} ${version}` : `기기 점검 시작 (${runId}) · ${kind} ${version}`);
  const run = await followRun(port, runId);
  if (run.outcomes.length === 0) console.log(noDevicesMessage);
  const code = runExitCode(run);
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

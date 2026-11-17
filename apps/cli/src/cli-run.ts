// CLI 점검을 진행 중 실행으로 farm.db 에 남긴다. 웹 서버가 DB에서 읽어 플로팅·결과 탭에 보인다.
import type { Device, DeviceRun, DeviceScreen } from "@device-farm/core/device/types";
import { writeRun } from "@device-farm/engine/results";
import { createRunId } from "@device-farm/engine/run";

export interface CliRun {
  run: DeviceRun;
  /** 지금 보는 화면. 플로팅 설명 줄 */
  current: (name: string) => void;
  push: (screen: DeviceScreen) => void;
  finish: () => DeviceRun;
}

export function startCliRun(label: string, device: Device, total: number): CliRun {
  const startedAt = new Date().toISOString();
  const run: DeviceRun = {
    runId: createRunId(Date.parse(startedAt)),
    kind: "dev",
    version: device.appVersion ?? "설치된 앱",
    trigger: "manual",
    startedAt,
    finishedAt: null,
    outcomes: [{ device, status: "running", phase: "checking", screens: [] }],
    scenarioCount: total,
    label,
  };
  const [outcome] = run.outcomes;
  // DB 쓰기가 실패해도 점검은 계속한다 — 플로팅은 부가 표시다
  const save = () => {
    try {
      writeRun(run);
    } catch (error) {
      console.warn(`진행 기록 실패: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  save();
  return {
    run,
    current: (name) => {
      outcome.current = name;
      save();
    },
    push: (screen) => {
      outcome.screens.push(screen);
      save();
    },
    finish: () => {
      delete outcome.phase;
      delete outcome.current;
      outcome.status = outcome.screens.some((screen) => screen.status === "failed") ? "failed" : "passed";
      run.finishedAt = new Date().toISOString();
      save();
      return run;
    },
  };
}

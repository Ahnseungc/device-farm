import type { Device, DeviceRun } from "@device-farm/core/device/types";
import { createRunId, runDevices, type RunDeps } from "@device-farm/engine/run";

import type { Signal } from "./build/watch";
import type { createJobGate } from "./jobs";

export interface AutoRunDeps {
  connected: () => Promise<Device[]>;
  gate: ReturnType<typeof createJobGate>;
  runDeps: () => RunDeps;
  /** 실행 기록 저장 + 최신 실행 갱신 */
  record: (run: DeviceRun) => void;
  log: (message: string) => void;
}

/** 자동 점검(watch.md)의 startRun·failIos. 수동 점검과 같은 게이트를 쓰되 409 대신 기다린다. */
export function createAutoRuns(deps: AutoRunDeps) {
  async function platformDevices(signal: Signal): Promise<Device[]> {
    return (await deps.connected()).filter((device) => device.platform === signal.target.platform);
  }

  async function runAuto(signal: Signal): Promise<void> {
    const { platform, kind } = signal.target;
    const ids = (await platformDevices(signal)).map((device) => device.id);
    if (ids.length === 0) {
      deps.log(`${platform}-${kind} ${signal.version} 자동 점검: 연결된 기기가 없어 건너뜁니다.`);
      return;
    }
    await deps.gate.startWhenIdle("run", () => runDevices({ kind, version: signal.version, deviceIds: ids, trigger: "auto" }, deps.runDeps()));
  }

  /** Ad-hoc을 끝내 못 찾은 TestFlight 빌드. iOS 기기를 install_failed로 닫은 자동 실행을 남긴다. */
  async function failIos(signal: Signal, message: string): Promise<void> {
    const at = new Date().toISOString();
    const ios = await platformDevices(signal);
    deps.record({
      runId: createRunId(Date.now()),
      kind: signal.target.kind,
      version: signal.version,
      trigger: "auto",
      startedAt: at,
      finishedAt: at,
      outcomes: ios.map((device) => ({ device, status: "install_failed", message, screens: [] })),
    });
  }

  return { runAuto, failIos };
}

import type { NetworkRecovery } from "@device-farm/core/device/driver";

/** 쉬는 기기의 오류 화면을 보는 간격 (작성자 판단) */
export const idleNetworkPollMs = 5 * 60_000;

export type IdleNetworkResult = "none" | "recovered" | "relaunched" | "skipped" | "error";

export interface IdleNetworkDeps {
  /** 점검·탐색·봇 점검이 돌고 있나. 돌면 그쪽이 고친다 */
  busy: () => boolean;
  /** 앱이 떠 있고 아무도 잡지 않은 Android 기기 id */
  idleDevices: () => Promise<string[]>;
  /** 기기를 잠그고 오류 화면을 다시 불러 본다. 잠금을 못 잡으면 null(그 기기는 건너뜀) */
  reload: (id: string) => Promise<NetworkRecovery | null>;
  /** reload로 안 풀리면 앱을 껐다 켠다 */
  relaunch: (id: string) => Promise<void>;
  log: (message: string) => void;
}

/** 한 바퀴: 쉬는 기기마다 오류 화면이면 다시 불러 보고, 안 되면 앱을 다시 켠다. 기기별 결과를 돌려준다 */
export async function checkIdleDevices(deps: IdleNetworkDeps): Promise<Record<string, IdleNetworkResult>> {
  const results: Record<string, IdleNetworkResult> = {};
  if (deps.busy()) return results;
  for (const id of await deps.idleDevices()) {
    if (deps.busy()) break;
    try {
      const result = await deps.reload(id);
      if (result === null) {
        results[id] = "skipped";
      } else if (result.status === "none") {
        results[id] = "none";
      } else if (result.status === "recovered") {
        results[id] = "recovered";
        deps.log(`${id} 쉬는 동안 뜬 네트워크 오류 화면(${result.code})을 다시 불러 고쳤습니다.`);
      } else {
        await deps.relaunch(id);
        results[id] = "relaunched";
        deps.log(`${id} 네트워크 오류 화면(${result.code})이 안 풀려 앱을 다시 켰습니다.`);
      }
    } catch (error) {
      results[id] = "error";
      deps.log(`${id} 네트워크 오류 화면 확인 실패: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return results;
}

/** 서버 타이머. 겹쳐 돌지 않는다 */
export function startIdleNetworkWatch(deps: IdleNetworkDeps, pollMs = idleNetworkPollMs): { stop: () => void; tick: () => Promise<void> } {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await checkIdleDevices(deps);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), pollMs);
  timer.unref();
  return { stop: () => clearInterval(timer), tick };
}

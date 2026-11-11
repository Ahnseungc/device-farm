// 카오스 탐색: npm run chaos -- --device <Android serial> [--seed 42] [--episodes 3] [--steps 50] [--minutes 60] [--no-guard]
// --no-guard: 쓰기 요청을 막지 않는다(dev 서버 전용). 위험한 이름의 버튼(구매·결제·탈퇴 등)은 그대로 누르지 않는다
// 결과: test-results/chaos/<runId>/run.json (스텝마다 후보 점수·고른 행동·이동·판정), 오류 화면 스크린샷
import path from "node:path";

import { openAndroidDriver } from "@device-farm/devices/android-driver";
import { execFileText } from "@device-farm/devices/exec";
import { listDevices } from "@device-farm/devices/registry";
import { runChaos } from "@device-farm/engine/chaos/run";
import { defaultGuard } from "@device-farm/engine/explore/run";
import { webOrigin } from "@device-farm/server/env";
import { loadExploreInputs } from "@device-farm/server/explore";

import { cliApp, farmPort } from "./app";


function option(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

/** 디바이스팜 점검이 도는 중이면 같은 기기를 같이 만지지 않는다. 서버가 꺼져 있으면 확인 없이 진행한다. */
async function farmBusy(): Promise<boolean> {
  const response = await fetch(`http://127.0.0.1:${farmPort()}/api/devices/runs/latest`).catch(() => null);
  if (!response?.ok) return false;
  const run = (await response.json().catch(() => null)) as { finishedAt?: string | null } | null;
  return Boolean(run && run.finishedAt === null);
}

async function main(): Promise<void> {
  const app = await cliApp();
  const serial = option("device");
  if (!serial) throw new Error("--device <Android serial>가 필요합니다.");
  if (await farmBusy()) throw new Error("디바이스팜 점검이 도는 중이라 기기를 쓸 수 없습니다.");
  const device = (await listDevices(execFileText, app.appIds.dev)).find((item) => item.id === serial && item.platform === "android");
  if (!device) throw new Error(`연결된 Android 기기가 아닙니다: ${serial}`);
  const origin = webOrigin(app, "dev");
  const { allowlist } = loadExploreInputs();
  const noGuard = process.argv.includes("--no-guard");
  if (noGuard) console.log(`쓰기 요청을 막지 않습니다(dev ${origin}).`);
  const run = await runChaos({
    device,
    appId: app.appIds.dev,
    exec: execFileText,
    openDriver: () => openAndroidDriver(device.id, app.appIds.dev, origin, app),
    guard: noGuard ? async () => async () => undefined : (driver, onBlocked) => defaultGuard(driver, origin, allowlist, (request) => onBlocked(`${request.method} ${request.path}`)),
    allowlist,
    seed: Number(option("seed", String(Date.now() % 100_000))),
    episodes: Number(option("episodes", "3")),
    stepsPerEpisode: Number(option("steps", "50")),
    minutes: Number(option("minutes", "60")),
    resultsDir: path.resolve("test-results/chaos"),
    log: (line) => console.log(line),
  });
  const errors = run.steps.filter((step) => step.errors.length > 0);
  console.log(`\n끝: 스텝 ${run.steps.length} · 상태 ${run.states} · 오류 스텝 ${errors.length} · 막은 쓰기 ${run.blocked.length}`);
  console.log(`기록: test-results/chaos/${run.runId}/run.json`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

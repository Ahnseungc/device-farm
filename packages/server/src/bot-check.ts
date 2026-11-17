import path from "node:path";

import type { ChaosRun } from "@device-farm/core/chaos/types";
import type { AppConfig } from "@device-farm/core/config/app-config";
import type { DeviceLocks } from "@device-farm/core/device/lock";
import type { Device } from "@device-farm/core/device/types";
import { openAndroidDriver } from "@device-farm/devices/android-driver";
import type { Exec } from "@device-farm/devices/exec";
import { causesOf, causesPrompt } from "@device-farm/core/chaos/causes";
import { deepStartPool } from "@device-farm/core/chaos/policy";
import { chaosVisitedPaths, readChaosRun, writeBotSummary, type BotSummary } from "@device-farm/engine/chaos/results";
import { runChaos } from "@device-farm/engine/chaos/run";
import { askClaude, type AskClaude } from "@device-farm/engine/policy/claude";
import { defaultGuard } from "@device-farm/engine/explore/run";
import { readScreenMap } from "@device-farm/engine/screen-map-store";

import { webOrigin } from "./env";
import { loadExploreInputs } from "./explore";

export interface BotCheckOptions {
  seed: number;
  minutes: number;
  episodes: number;
  stepsPerEpisode: number;
}

export interface BotCheckDeps {
  app: AppConfig;
  exec: Exec;
  locks: DeviceLocks;
  connected: () => Promise<Device[]>;
  log: (message: string) => void;
  /** 기기 하나의 봇 점검이 요약까지 끝나면 부른다(슬랙 끝 알림) */
  onFinished?: (run: ChaosRun, summary: string | null) => Promise<void>;
  /** 디바이스팜 「중지」. 도는 기기는 지금 스텝을 마치고, 남은 기기는 건너뛴다 */
  signal?: AbortSignal;
}

/**
 * 서버에서 봇 점검을 돌린다(CLI `npm run bot-check`와 같은 실행, docs/design-chaos.md). 연결된 Android dev 기기마다 차례로.
 * 사람이 조작 중인 기기(잠금)는 건너뛴다. 쓰기 요청은 탐색과 같은 허용 목록으로 막는다. 돈 실행 id 목록을 돌려준다.
 */
export async function runBotCheck(options: BotCheckOptions, deps: BotCheckDeps): Promise<string[]> {
  const { app } = deps;
  const origin = webOrigin(app, "dev");
  const { allowlist } = loadExploreInputs();
  // 깊은 시작 후보: 화면 지도(버튼 눌러보기)와 지난 봇 점검이 닿은 경로
  const edges = readScreenMap().edges;
  const startPaths = deepStartPool([...edges.flatMap((edge) => [edge.from, edge.to ?? ""]), ...chaosVisitedPaths()], app.guard.noPressPathPattern);
  const devices = (await deps.connected()).filter((device) => device.platform === "android");
  const runIds: string[] = [];
  for (const device of devices) {
    if (deps.signal?.aborted) break;
    const owner = { kind: "bot" as const, runId: `bot-${options.seed}-${device.id}` };
    if (!deps.locks.acquire(device.id, owner)) {
      deps.log(`봇 점검: ${device.id}는 사람이 조작 중이라 건너뜀`);
      continue;
    }
    try {
      const run: ChaosRun = await runChaos({
        device,
        appId: app.appIds.dev,
        exec: deps.exec,
        openDriver: () => openAndroidDriver(device.id, app.appIds.dev, origin, app),
        guard: (driver, onBlocked) => defaultGuard(driver, origin, allowlist, (request) => onBlocked(`${request.method} ${request.path}`)),
        allowlist,
        seed: options.seed,
        episodes: options.episodes,
        stepsPerEpisode: options.stepsPerEpisode,
        minutes: options.minutes,
        startPaths,
        signal: deps.signal,
        resultsDir: path.resolve("test-results/chaos"),
        log: (line) => deps.log(`봇 점검 ${device.id} ${line}`),
      });
      runIds.push(run.runId);
      // 끝난 실행마다 원인 한 줄 요약을 붙인다. 실패해도 점검 결과는 그대로(화면에서 다시 만들 수 있다)
      const summary = await summarizeBotRun(run.runId, askClaude, app.name).catch((error: unknown) => {
        deps.log(`봇 점검 요약 실패: ${error instanceof Error ? error.message : String(error)}`);
        return null;
      });
      await deps.onFinished?.(readChaosRun(run.runId) ?? run, summary?.text ?? null).catch((error: unknown) => deps.log(`봇 점검 슬랙 알림 실패: ${error instanceof Error ? error.message : String(error)}`));
      deps.log(`봇 점검 ${device.id} 끝: 스텝 ${run.steps.length} · 상태 ${run.states} · 오류 스텝 ${run.steps.filter((step) => step.errors.length > 0).length}`);
    } catch (error) {
      deps.log(`봇 점검 ${device.id} 실패: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      deps.locks.release(device.id, owner);
    }
  }
  return runIds;
}

/** 고칠 문제가 없을 때 쓰는 요약(Claude를 부르지 않는다) */
export const cleanBotSummary = "고칠 문제가 없어요.";

/**
 * 봇 점검 실행 하나를 원인별로 묶어 Claude에게 한두 문장으로 정리하게 하고 저장한다(docs/design-chaos.md).
 * 고칠 문제가 없으면 Claude 없이 「고칠 문제가 없어요」. 실행이 없으면 null.
 */
export async function summarizeBotRun(runId: string, ask: AskClaude = askClaude, appName?: string): Promise<BotSummary | null> {
  const run = readChaosRun(runId);
  if (!run) return null;
  const causes = causesOf(run);
  const text = causes.some((cause) => cause.level === "problem") ? (await ask(causesPrompt(run, causes, appName))).trim().split("\n")[0].slice(0, 200) : cleanBotSummary;
  const summary = { text, at: new Date().toISOString() };
  writeBotSummary(runId, summary);
  return summary;
}

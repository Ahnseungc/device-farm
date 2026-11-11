/**
 * 데모 빌드에서 `./api-client` 대신 쓰는 모듈(demo/vite.config.ts가 바꿔 끼운다).
 * 읽기는 fixtures.ts를 돌려주고, 바꾸는 요청은 토스트만 띄우고 거절한다. 서버·기기를 부르지 않는다.
 */
import type { LogEntry } from "@device-farm/core/device/types";

import { ApiError, type api as realApi } from "../api-client";
import {
  candidateScreens,
  demoApp,
  demoChaosRuns,
  demoChaosSummaries,
  demoDevices,
  demoExplore,
  demoFiles,
  demoFlows,
  demoLogs,
  demoPendingBaselines,
  demoPolicy,
  demoPolicyIgnored,
  demoRun,
  demoScreenMap,
  liveScreens,
} from "./fixtures";
import { screenUrl } from "./screens";
import { mountDemoRibbon, showDemoToast } from "./toast";

export * from "../api-client";

export const readOnlyMessage = "Demo mode: read-only";
/** 이미지가 없는 파일(영상 등). img·video가 onError로 「없음」을 보인다 */
const missingFile = "data:,";
const resultRootMarker = "test-results/";
const forbiddenStatus = 403;

mountDemoRibbon();

const read = <T>(value: T) => () => Promise.resolve(structuredClone(value));

function readOnly(): Promise<never> {
  showDemoToast(readOnlyMessage);
  return Promise.reject(new ApiError(forbiddenStatus, readOnlyMessage));
}

export const api: typeof realApi = {
  app: read(demoApp),
  devices: read(demoDevices),
  stopRun: readOnly,
  startRun: readOnly,
  latestRun: read(demoRun),
  pendingBaselines: read(demoPendingBaselines),
  confirmBaselines: readOnly,
  sendInput: readOnly,
  lock: readOnly,
  unlock: readOnly,
  touchLock: readOnly,
  startExplore: readOnly,
  flows: read(demoFlows),
  generateFlows: readOnly,
  addMapFlow: readOnly,
  screenMap: read(demoScreenMap),
  confirmFlows: readOnly,
  chaosRuns: read(demoChaosSummaries),
  chaosRun: (id: string) => {
    const run = demoChaosRuns.find((item) => item.runId === id);
    return run ? Promise.resolve(structuredClone(run)) : Promise.reject(new ApiError(404, "카오스 실행을 찾지 못했습니다."));
  },
  policy: read(demoPolicy),
  checkPolicy: readOnly,
  policyIgnored: read(demoPolicyIgnored),
  ignorePolicy: readOnly,
  unignorePolicy: readOnly,
  latestExplore: read(demoExplore),
  replay: readOnly,
};

/** 후보 키 `model|osVersion|scenario`의 화면 이름으로 데모 화면을 고른다 */
export function candidateImageUrl(name: string): string {
  const scenario = name.split("|").slice(2).join("|");
  const screen = candidateScreens[scenario];
  return screen ? screenUrl(screen) : missingFile;
}

export function mjpegUrl(id: string): string {
  return screenUrl(liveScreens[id] ?? "home");
}

export function streamSocketUrl(): string {
  return "";
}

export function resultFileUrl(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const index = normalized.lastIndexOf(resultRootMarker);
  const relative = index >= 0 ? normalized.slice(index + resultRootMarker.length) : normalized.replace(/^\/+/, "");
  return demoFiles[relative] ?? missingFile;
}

export async function fetchLogs(): Promise<LogEntry[]> {
  return structuredClone(demoLogs);
}

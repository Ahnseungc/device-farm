import type { AppConfig } from "@device-farm/core/config/app-config";
import type { InputEvent } from "@device-farm/core/device/input";
import type { DeviceLocks } from "@device-farm/core/device/lock";
import type { Device, DeviceRun, DeviceState, Platform } from "@device-farm/core/device/types";
import type { Issue } from "@device-farm/core/explore/probe";
import type { PolicyWatchState } from "@device-farm/core/policy/snapshot";
import type { ExploreResult } from "@device-farm/engine/explore/results";
import type { RunRequest } from "@device-farm/engine/run";

export type DeviceWithState = Device & { state: DeviceState };
export type StartResult = { ok: true; runId: string } | { ok: false; error: string };
export type ControlAction = "lock" | "release" | "expire";
export type ControlEntry = { at: number; user: string; deviceId: string; action: ControlAction };

/** WebSocket 첫 메시지 */
export interface VideoHeader {
  codec: string;
  width: number;
  height: number;
}

export interface VideoSink {
  header: (header: VideoHeader) => void;
  packet: (packet: Uint8Array) => void;
}

/** device-api가 쓰는 서버 상태. 진짜 구현은 createFarm, 테스트는 가짜. */
export interface Farm {
  /** 점검 대상 앱 설정 */
  app: AppConfig;
  /** `/api/devices/files`가 여는 루트(`test-results`). */
  resultsRoot: string;
  locks: DeviceLocks;
  /** iOS MJPEG 원본 주소 */
  mjpegUrl: string;
  /** iOS MJPEG를 주기 전에 WDA 세션이 살아 있게 한다. 끊겼으면 새로 연다. */
  ensureIosSession?: (id: string) => Promise<void>;
  isBusy: () => boolean;
  listDevices: () => Promise<DeviceWithState[]>;
  platformOf: (id: string) => Promise<Platform | null>;
  startRun: (request: Omit<RunRequest, "runId" | "trigger">) => StartResult;
  /** 도는 수동 점검을 멈춘다. 멈출 점검이 없으면 false */
  stopRun: () => boolean;
  latestRun: () => DeviceRun | null;
  pendingBaselines: () => string[];
  candidatePng: (name: string) => Buffer | null;
  confirmBaselines: (names?: readonly string[]) => number;
  startExplore: (request: { deviceIds: readonly string[] | "all" }) => StartResult;
  latestExplore: () => ExploreResult[];
  /** 실패는 ExploreRequestError(status) 또는 일반 Error */
  replay: (input: { runId: string; deviceId: string; pathId: string }) => Promise<Issue[]>;
  sendInput: (id: string, platform: Platform, event: InputEvent) => Promise<void>;
  /** Android 영상 구독. 해제 함수를 돌려준다. */
  watchVideo: (id: string, sink: VideoSink) => Promise<() => void>;
  recordControl: (entry: Omit<ControlEntry, "at">) => void;
  /** 정책 바뀜 감지 상태(서버 시작 전에는 null) */
  policyState: () => PolicyWatchState | null;
  /** 지금 정책 확인. 이미 도는 중이거나 서버 시작 전이면 false */
  checkPolicy: () => boolean;
}

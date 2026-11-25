import type { AppConfig } from "@device-farm/core/config/app-config";
import type { InputEvent } from "@device-farm/core/device/input";
import type { DeviceLocks } from "@device-farm/core/device/lock";
import type { Device, DeviceRun, DeviceState, Platform } from "@device-farm/core/device/types";
import type { Issue } from "@device-farm/core/explore/probe";
import type { FarmIssue } from "@device-farm/core/issues/issue";
import type { PolicyWatchState } from "@device-farm/core/policy/snapshot";
import type { RunSummary } from "@device-farm/core/runs/summary";
import type { AlertStatus } from "@device-farm/core/slack/policy-alert";
import type { DailyReport } from "@device-farm/engine/report/daily-store";
import type { ExploreResult } from "@device-farm/engine/explore/results";
import type { DesignPage } from "@device-farm/engine/policy/design-pages";
import type { RunRequest } from "@device-farm/engine/run";

import type { JobQueueState } from "./queue/job-queue";

export type DeviceWithState = Device & { state: DeviceState };
/** position 0이면 바로 시작, n이면 대기열 n번째 */
export type StartResult = { ok: true; runId: string; position: number } | { ok: false; error: string };
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
  /** key: 키프레임(IDR). 느린 화면은 키프레임까지 건너뛰는 데 쓴다 */
  packet: (packet: Uint8Array, key: boolean) => void;
}

/** device-api가 쓰는 서버 상태. 진짜 구현은 createFarm, 테스트는 가짜. */
/** 플로팅에서 멈출 수 있는 작업 */
export const stoppableJobs = ["run", "bot", "explore", "policy"] as const;
export type StoppableJob = (typeof stoppableJobs)[number];

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
  /** 작업이 돌고 있나(대기열 맨 앞). 기준·플로우 확정을 막는 데 쓴다 */
  isBusy: () => boolean;
  /** 도는 작업과 기다리는 작업(queue/specs) */
  jobQueue: () => JobQueueState;
  /** 기다리는 작업 빼기. 대기열에 없으면(이미 시작·빠짐) false */
  cancelQueued: (id: string) => boolean;
  listDevices: () => Promise<DeviceWithState[]>;
  platformOf: (id: string) => Promise<Platform | null>;
  startRun: (request: Omit<RunRequest, "runId" | "trigger">) => StartResult;
  /** 도는 수동 점검을 멈춘다. 멈출 점검이 없으면 false */
  stopRun: () => boolean;
  /** 진행 중 플로팅의 「중지」. 그 종류의 작업이 이 서버에서 돌고 있지 않으면 false(CLI로 돈 것 포함) */
  stopJob: (kind: StoppableJob) => boolean;
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
  /** 「점검 기록」 실행 요약(최근 것부터) */
  runSummaries: () => RunSummary[];
  /** 「디자인 점검」: 점검할 수 있는 디자인 화면 전부와 마지막 결과 */
  designPages: () => DesignPage[];
  /** 실행 하나 */
  runById: (runId: string) => DeviceRun | null;
  /** 「문제」 목록(알림 기록). 열린 것 먼저 */
  issues: () => FarmIssue[];
  /** 문제 상태 바꾸기(슬랙 메시지도 고친다). 모르는 키면 false */
  setIssueStatus: (key: string, status: Exclude<AlertStatus, "open">) => Promise<boolean>;
  /** 가장 최근 아침 분석 */
  latestDailyReport: () => DailyReport | null;
  /** 봇 점검을 지금 돌린다(연결된 Android 기기마다 차례로) */
  startBot: () => StartResult;
}

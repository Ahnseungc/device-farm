import { useCallback, useEffect, useRef, useState } from "react";

import type { ChaosRun, ChaosRunSummary } from "@device-farm/core/chaos/types";
import type { PublicAppConfig } from "@device-farm/core/config/app-config";
import type { InputEvent } from "@device-farm/core/device/input";
import type { ScreenMap } from "@device-farm/core/device/screen-map";
import type { BuildKind, Device, DeviceRun, DeviceState, LogEntry } from "@device-farm/core/device/types";
import type { ExploreRun } from "@device-farm/core/explore/actions";
import type { Issue } from "@device-farm/core/explore/probe";
import type { PolicyIgnore } from "@device-farm/core/policy/compare";
import type { PolicyWatchState } from "@device-farm/core/policy/snapshot";
import type { FlowDocument, FlowStep } from "@device-farm/core/flows/schema";

import { t } from "./i18n";

export type DeviceWithState = Device & { state: DeviceState };
export type DeviceSelection = string[] | "all";
export type FlowsState = { candidates: FlowDocument[]; ready: FlowDocument[]; prds: string[]; prdRootSet: boolean; llmConfigured: boolean };
export type FlowGenerateResult = { ok: true; generated: number; skipped: boolean; reason?: string };

export const pollIntervalMs = 2_000;

/**
 * 스펙 밖 가정: 실패 묶음·탐색 파일은 서버가 `test-results/` 아래 상대 경로로 내준다고 본다.
 * 서버 경로가 정해지면 이 한 곳만 고친다.
 */
export const resultFileEndpoint = "/api/devices/files";
const resultRootMarker = "test-results/";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function errorText(body: unknown, status: number): string {
  if (typeof body === "object" && body !== null && "error" in body && typeof body.error === "string") return body.error;
  return `${t("요청이 실패했습니다.", "Request failed.")} (${status})`;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  if (!response.ok) throw new ApiError(response.status, errorText(parsed, response.status));
  return parsed as T;
}

/** 화면에 보일 오류 문장. 서버의 `{ error }`를 그대로 쓴다. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return `${error.status} · ${error.message}`;
  if (error instanceof Error) return error.message;
  return t("알 수 없는 오류가 났습니다.", "An unknown error occurred.");
}

const devicePath = (id: string) => `/api/devices/${encodeURIComponent(id)}`;

export const api = {
  app: () => request<PublicAppConfig>("GET", "/api/devices/app"),
  devices: () => request<DeviceWithState[]>("GET", "/api/devices"),
  stopRun: () => request<{ stopping: true }>("POST", "/api/devices/run/stop"),
  startRun: (body: { kind: BuildKind; version?: string; devices: DeviceSelection; flowsOnly?: boolean; buttonCheck?: boolean }) =>
    request<{ runId: string }>("POST", "/api/devices/run", body),
  latestRun: () => request<DeviceRun | null>("GET", "/api/devices/runs/latest"),

  pendingBaselines: () => request<string[]>("GET", "/api/devices/baselines/pending"),
  confirmBaselines: (names?: string[]) =>
    request<{ confirmed: number }>("POST", "/api/devices/baselines/confirm", names ? { names } : {}),

  sendInput: (id: string, event: InputEvent) => request<unknown>("POST", `${devicePath(id)}/input`, event),
  lock: (id: string) => request<unknown>("POST", `${devicePath(id)}/lock`),
  unlock: (id: string) => request<unknown>("DELETE", `${devicePath(id)}/lock`),
  touchLock: (id: string) => request<unknown>("POST", `${devicePath(id)}/lock/touch`),

  startExplore: (devices: DeviceSelection) =>
    request<{ runId: string }>("POST", "/api/devices/explore", { devices, build: "dev" }),
  flows: () => request<FlowsState>("GET", "/api/devices/flows"),
  generateFlows: (prd: string) => request<FlowGenerateResult>("POST", "/api/devices/flows/generate", { prd }),
  addMapFlow: (body: { name: string; steps: FlowStep[] }) => request<{ id: string }>("POST", "/api/devices/flows/from-map", body),
  screenMap: () => request<ScreenMap>("GET", "/api/devices/screen-map"),
  confirmFlows: (ids?: string[]) => request<{ confirmed: number }>("POST", "/api/devices/flows/confirm", ids ? { ids } : {}),

  chaosRuns: () => request<ChaosRunSummary[]>("GET", "/api/devices/chaos"),
  chaosRun: (id: string) => request<ChaosRun>("GET", `/api/devices/chaos/run?id=${encodeURIComponent(id)}`),
  policy: () => request<PolicyWatchState | null>("GET", "/api/devices/policy"),
  checkPolicy: () => request<{ started: true }>("POST", "/api/devices/policy/check"),
  policyIgnored: () => request<{ items: PolicyIgnore[] }>("GET", "/api/devices/policy/ignored"),
  ignorePolicy: (body: { key: string; hash: string; reason: string }) => request<{ items: PolicyIgnore[] }>("POST", "/api/devices/policy/ignore", body),
  unignorePolicy: (body: { key: string; hash: string }) => request<{ items: PolicyIgnore[] }>("POST", "/api/devices/policy/unignore", body),

  latestExplore: () => request<ExploreRun[]>("GET", "/api/devices/explore/latest"),
  replay: (body: { runId: string; deviceId: string; pathId: string }) =>
    request<Issue[]>("POST", "/api/devices/explore/replay", body),
};

export function candidateImageUrl(name: string): string {
  return `/api/devices/baselines/candidate?name=${encodeURIComponent(name)}`;
}

export function mjpegUrl(id: string): string {
  return `${devicePath(id)}/mjpeg`;
}

export function streamSocketUrl(id: string): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}${devicePath(id)}/stream`;
}

/** 절대 경로든 상대 경로든 `test-results/` 뒤만 남겨 파일 URL로 바꾼다. */
export function resultFileUrl(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const index = normalized.lastIndexOf(resultRootMarker);
  const relative = index >= 0 ? normalized.slice(index + resultRootMarker.length) : normalized.replace(/^\/+/, "");
  return `${resultFileEndpoint}?path=${encodeURIComponent(relative)}`;
}

export function joinPath(dir: string, name: string): string {
  return `${dir.replace(/[\\/]+$/, "")}/${name}`;
}

function isLogEntry(value: unknown): value is LogEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.at === "number" && typeof entry.source === "string" && typeof entry.text === "string";
}

/** 실패 묶음의 `logs.jsonl`. 모양이 틀린 줄은 건너뛴다. */
export async function fetchLogs(logDir: string): Promise<LogEntry[]> {
  const response = await fetch(resultFileUrl(joinPath(logDir, "logs.jsonl")));
  if (!response.ok) throw new ApiError(response.status, t("로그 파일을 읽지 못했습니다.", "Could not read the log file."));
  const entries: LogEntry[] = [];
  for (const line of (await response.text()).split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (isLogEntry(parsed)) entries.push(parsed);
    } catch {
      // 잘린 마지막 줄 등은 목록에서 뺀다.
    }
  }
  return entries;
}

/** `load`를 바로 한 번, 그 뒤 `intervalMs`마다 부른다. */
export function usePoll<T>(load: () => Promise<T>, intervalMs = pollIntervalMs) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const loadRef = useRef(load);
  loadRef.current = load;

  const reload = useCallback(async () => {
    try {
      setData(await loadRef.current());
      setError(null);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }, []);

  useEffect(() => {
    void reload();
    const timer = window.setInterval(() => void reload(), intervalMs);
    return () => window.clearInterval(timer);
  }, [reload, intervalMs]);

  return { data, error, reload };
}

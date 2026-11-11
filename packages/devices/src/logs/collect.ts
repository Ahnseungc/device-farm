import { spawn, type ChildProcessByStdio } from "node:child_process";
import { createInterface } from "node:readline";
import type { Readable } from "node:stream";

import type { ConsoleMessage, Request, Response } from "playwright";

import type { ScreenDriver } from "@device-farm/core/device/driver";
import type { Device, LogEntry } from "@device-farm/core/device/types";
import { formatNetworkLog } from "@device-farm/core/logs/network";
import type { LogRing } from "@device-farm/core/logs/ring";

import type { AndroidScreenDriver } from "../android-driver";
import { execFileText, type Exec } from "../exec";
import { getIosSession } from "../ios-session";

export type LogLine = Omit<LogEntry, "at">;

export const safariPollMs = 2_000;
export const httpErrorStatus = 400;
const androidCrashMarker = "FATAL EXCEPTION";
const iosCrashMarker = "Terminating app due to uncaught exception";

type LineProcess = ChildProcessByStdio<null, Readable, null>;

export interface CollectorDeps {
  exec?: Exec;
  spawnProcess?: (command: string, args: string[]) => LineProcess;
  /** iOS. 없으면 getIosSession(device.id, appId)의 공유 세션. */
  iosSession?: WebdriverIO.Browser;
  pollMs?: number;
}

type Stop = () => Promise<void>;

// ---- 순수 변환 ----

/** 요청 주소에서 쿼리·해시를 뗀다. 토큰이 쿼리에 실릴 수 있어서다. */
export function safeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url.split(/[?#]/)[0];
  }
}

export function logcatLineToEntry(line: string): LogLine | null {
  const text = line.trim();
  if (!text) return null;
  return { source: text.includes(androidCrashMarker) ? "crash" : "system", text };
}

export function syslogLineToEntry(line: string): LogLine | null {
  const text = line.trim();
  if (!text) return null;
  return { source: text.includes(iosCrashMarker) ? "crash" : "system", text };
}

export function consoleToEntry(type: string, text: string): LogLine | null {
  return type === "error" ? { source: "console", text } : null;
}

export function responseToEntry(status: number, method: string, url: string): LogLine | null {
  if (status < httpErrorStatus) return null;
  return { source: "network", text: formatNetworkLog(method || "UNKNOWN", status, safeUrl(url)) };
}

export function requestFailedToEntry(method: string, url: string, errorText: string): LogLine {
  return { source: "network", text: formatNetworkLog(method, 0, safeUrl(url), errorText) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Appium 로그 항목의 message는 JSON 문자열이다. 아니면 null. */
function parseMessage(entry: unknown): Record<string, unknown> | null {
  if (!isRecord(entry) || typeof entry.message !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(entry.message);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null; // JSON이 아닌 항목은 모양을 모르니 버린다.
  }
}

const severeLevels = ["error", "SEVERE"] as const;

/** safariConsole 항목 → error만. 본문·스택 등 다른 필드는 버린다. */
export function safariConsoleToEntry(entry: unknown): LogLine | null {
  const message = parseMessage(entry);
  if (!message || typeof message.text !== "string") return null;
  const outerLevel = isRecord(entry) ? entry.level : undefined;
  const isError = severeLevels.some((level) => level === message.level || level === outerLevel);
  return isError ? { source: "console", text: message.text } : null;
}

function responseOf(params: Record<string, unknown>): LogLine | null {
  const response = params.response;
  if (!isRecord(response) || typeof response.status !== "number" || typeof response.url !== "string") return null;
  return responseToEntry(response.status, "", response.url);
}

/** safariNetwork(Web Inspector Network 이벤트) → 상태 ≥ 400 응답과 실패만. 헤더·본문은 버린다. */
export function safariNetworkToEntry(entry: unknown): LogLine | null {
  const message = parseMessage(entry);
  if (!message || !isRecord(message.params)) return null;
  if (message.method === "Network.responseReceived") return responseOf(message.params);
  if (message.method === "Network.loadingFailed") {
    const errorText = typeof message.params.errorText === "string" ? message.params.errorText : "";
    return { source: "network", text: formatNetworkLog("UNKNOWN", 0, "-", errorText) };
  }
  return null;
}

// ---- 수집기 ----

const defaultSpawn = (command: string, args: string[]): LineProcess =>
  spawn(command, args, { stdio: ["ignore", "pipe", "ignore"] });

function pipeLines(child: LineProcess, ring: LogRing, toEntry: (line: string) => LogLine | null, label: string): Stop {
  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    const entry = toEntry(line);
    if (entry) ring.push(entry);
  });
  child.on("error", (error) => ring.push({ source: "system", text: `${label} 실행 실패: ${error.message}` }));
  return async () => {
    lines.close();
    child.kill("SIGTERM");
  };
}

function isAndroidDriver(driver: ScreenDriver): driver is AndroidScreenDriver {
  return "context" in driver;
}

function watchPage(driver: AndroidScreenDriver, ring: LogRing): Stop {
  // 스택마다 WebView(페이지)가 새로 생긴다. context에 걸어 전부 받는다.
  const page = driver.context;
  const push = (entry: LogLine | null) => entry && ring.push(entry);
  const onConsole = (message: ConsoleMessage) => push(consoleToEntry(message.type(), message.text()));
  const onResponse = (response: Response) =>
    push(responseToEntry(response.status(), response.request().method(), response.url()));
  const onFailed = (request: Request) =>
    push(requestFailedToEntry(request.method(), request.url(), request.failure()?.errorText ?? ""));
  page.on("console", onConsole);
  page.on("response", onResponse);
  page.on("requestfailed", onFailed);
  return async () => {
    page.off("console", onConsole);
    page.off("response", onResponse);
    page.off("requestfailed", onFailed);
  };
}

async function appPid(serial: string, appId: string, exec: Exec): Promise<string> {
  const pid = (await exec("adb", ["-s", serial, "shell", "pidof", appId])).trim().split(/\s+/)[0];
  if (!pid) throw new Error(`${appId} 앱이 실행 중이 아닙니다.`);
  return pid;
}

// 실기기 확인: --pid 필터가 앱 크래시(FATAL EXCEPTION)를 놓치지 않는지. 크래시 줄이 system_server 쪽 pid로 찍히면 빠질 수 있다.
async function startAndroid(device: Device, appId: string, driver: ScreenDriver, ring: LogRing, deps: CollectorDeps): Promise<Stop[]> {
  const pid = await appPid(device.id, appId, deps.exec ?? execFileText);
  const spawnProcess = deps.spawnProcess ?? defaultSpawn;
  const stops = [pipeLines(spawnProcess("adb", ["-s", device.id, "logcat", `--pid=${pid}`]), ring, logcatLineToEntry, "logcat")];
  if (isAndroidDriver(driver)) stops.push(watchPage(driver, ring));
  return stops;
}

function pollSafariLogs(session: WebdriverIO.Browser, ring: LogRing, pollMs: number): Stop {
  let lastError = "";
  let polling = false;
  const pull = async (type: string, toEntry: (entry: unknown) => LogLine | null) => {
    const entries: unknown[] = await session.getLogs(type);
    for (const entry of entries) {
      const line = toEntry(entry);
      if (line) ring.push(line);
    }
  };
  const poll = async () => {
    if (polling) return;
    polling = true;
    try {
      await pull("safariConsole", safariConsoleToEntry);
      await pull("safariNetwork", safariNetworkToEntry);
      lastError = "";
    } catch (error) {
      const text = `safari 로그 수집 실패: ${error instanceof Error ? error.message : String(error)}`;
      if (text !== lastError) ring.push({ source: "system", text }); // 같은 실패는 2초마다 반복하지 않는다.
      lastError = text;
    } finally {
      polling = false;
    }
  };
  const timer = setInterval(() => void poll(), pollMs);
  return async () => clearInterval(timer);
}

// 실기기 확인: getLogs("safariConsole"/"safariNetwork")의 message JSON 모양이 파서 가정(text·level / method·params)과 맞는지.
async function startIos(device: Device, appId: string, ring: LogRing, deps: CollectorDeps): Promise<Stop[]> {
  const session = deps.iosSession ?? (await getIosSession(device.id, appId));
  const spawnProcess = deps.spawnProcess ?? defaultSpawn;
  return [
    pipeLines(spawnProcess("idevicesyslog", ["-u", device.id, "-p", "Runner"]), ring, syslogLineToEntry, "idevicesyslog"),
    pollSafariLogs(session, ring, deps.pollMs ?? safariPollMs),
  ];
}

/** 플랫폼별 수집기를 띄우고, 모두 멈추는 함수를 돌려준다. */
export async function startCollectors(
  device: Device,
  appId: string,
  driver: ScreenDriver,
  ring: LogRing,
  deps: CollectorDeps = {},
): Promise<Stop> {
  const stops = device.platform === "android"
    ? await startAndroid(device, appId, driver, ring, deps)
    : await startIos(device, appId, ring, deps);
  return async () => {
    await Promise.all(stops.map((stop) => stop()));
  };
}

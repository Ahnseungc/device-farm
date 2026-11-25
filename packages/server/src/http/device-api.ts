import { readFileSync, realpathSync, statSync } from "node:fs";
import { get as httpGet, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";

import type { Plugin, PreviewServer, ViteDevServer } from "vite";
import { WebSocket, WebSocketServer } from "ws";

import { publicAppConfig, type AppConfig } from "@device-farm/core/config/app-config";
import { parseInputEvent } from "@device-farm/core/device/input";
import type { BuildKind } from "@device-farm/core/device/types";
import { mapFlowError, mapFlowPrd, mapRulesOf } from "@device-farm/core/flows/map-flow";
import { stepsOf, type FlowDocument } from "@device-farm/core/flows/schema";
import { iosBackUnsupported } from "@device-farm/devices/stream/ios";
import { listChaosRuns, readBotSummary, readChaosRun } from "@device-farm/engine/chaos/results";
import { farmDb } from "@device-farm/engine/db/farm-db";
import { ExploreRequestError } from "@device-farm/engine/explore/run";
import { generateFromPrd } from "@device-farm/engine/flows/generate";
import { llmConfigured } from "@device-farm/engine/flows/llm";
import { addCandidate, confirmFlows, listPrds, prdHash, prdRoot, readCandidates, readReady } from "@device-farm/engine/flows/store";
import { addIgnore, readIgnores, removeIgnore } from "@device-farm/engine/policy/rules-store";
import { errorMessage, installedVersionLabel } from "@device-farm/engine/run";
import { readScreenMap } from "@device-farm/engine/screen-map-store";

import { allowedDomains, decideAccess, localUser } from "../access";
import { createAuthGate, requestUser, setRequestUser, upgradeRefusal, type AuthGate } from "../auth/http";
import { notQueuedMessage } from "../queue/job-queue";
import { dbSessionStore } from "../auth/sessions";
import { summarizeBotRun } from "../bot-check";
import { createFarm } from "../farm";
import { stoppableJobs, type Farm } from "../types";

export const prodExploreMessage = "운영 빌드는 탐색하지 않습니다.";
export const noLockMessage = "조작 잠금이 없습니다. 먼저 조작을 시작해 주세요.";
export const botLockMessage = "봇이 점검 중인 기기입니다.";
export const baselineBusyMessage = "기기 점검 중에는 기준을 확정할 수 없습니다.";
export const flowBusyMessage = "기기 점검 중에는 플로우를 확정할 수 없습니다.";
export { localUser };

const apiPrefix = "/api/devices";
const maxBodyBytes = 1024 * 1024;
/** 화면 지도 플로우 id에 붙이는 스텝 해시 길이 (작성자 판단) */
const mapFlowIdHashLength = 8;
const buildKinds = ["dev", "prod"] as const satisfies readonly BuildKind[];
const resultFileTypes = {
  ".png": "image/png",
  ".mp4": "video/mp4",
  ".jsonl": "application/x-ndjson; charset=utf-8",
  ".json": "application/json; charset=utf-8",
} as const;
/** WebSocket close reason은 123바이트까지 */
const closeReasonLength = 60;

type Next = (error?: unknown) => void;
type Body = Record<string, unknown>;
type DeviceSelection = string[] | "all";

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(body));
}

function sendFile(res: ServerResponse, type: string, data: Buffer): void {
  res.statusCode = 200;
  res.setHeader("content-type", type);
  res.setHeader("cache-control", "no-store");
  res.end(data);
}

async function readBody(req: IncomingMessage): Promise<Body> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += buffer.length;
    if (size > maxBodyBytes) throw new HttpError(413, "요청 본문이 너무 큽니다.");
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new HttpError(400, "요청 본문이 JSON이 아닙니다.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new HttpError(400, "요청 본문은 JSON 객체여야 합니다.");
  return parsed as Body;
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new HttpError(400, `${field}는 빈 문자열이 아니어야 합니다.`);
  return value.trim();
}

function parseDevices(value: unknown): DeviceSelection {
  if (value === "all") return "all";
  if (Array.isArray(value) && value.length > 0 && value.every((id) => typeof id === "string" && id.trim())) return value.map((id: string) => id.trim());
  throw new HttpError(400, 'devices는 "all" 또는 기기 id 배열이어야 합니다.');
}

function parseFlowIds(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value) && value.length > 0 && value.every((id) => typeof id === "string" && id.trim())) return value.map((id: string) => id.trim());
  throw new HttpError(400, "flowIds는 플로우 id 배열이어야 합니다.");
}

function parseScenarioNames(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value) && value.length > 0 && value.every((name) => typeof name === "string" && name.trim())) return [...new Set(value.map((name: string) => name.trim()))];
  throw new HttpError(400, "scenarioNames는 화면 시나리오 이름 배열이어야 합니다.");
}

/** 이어서 돌릴 때 건너뛸 항목 이름(멈춘 점검에서 결과가 남은 것). 빈 배열도 받는다 */
function parseSkipNames(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value) && value.every((name) => typeof name === "string" && name.trim())) return [...new Set(value.map((name: string) => name.trim()))];
  throw new HttpError(400, "skipNames는 항목 이름 배열이어야 합니다.");
}

function parseKind(value: unknown): BuildKind {
  const kind = buildKinds.find((item) => item === value);
  if (!kind) throw new HttpError(400, "kind는 dev 또는 prod여야 합니다.");
  return kind;
}

function parseNames(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value) && value.every((name) => typeof name === "string")) return value;
  throw new HttpError(400, "names는 문자열 배열이어야 합니다.");
}

/**
 * 모든 요청(화면·API·파일·MJPEG)의 첫 관문(팀 비밀번호를 안 켰을 때). 허용 계정이 아니면 여기서 끝낸다(`access.ts`).
 * API는 `{ error }` JSON, 화면은 한 줄 안내.
 */
export function createAccessMiddleware(domains: readonly string[]) {
  return (req: IncomingMessage, res: ServerResponse, next: () => void): void => accessGate(req, res, next, domains);
}

function accessGate(req: IncomingMessage, res: ServerResponse, next: () => void, domains: readonly string[]): void {
  const access = decideAccess({ remoteAddress: req.socket.remoteAddress, headers: req.headers }, domains);
  if (access.ok) {
    setRequestUser(req, access.user);
    return next();
  }
  res.statusCode = access.status;
  res.setHeader("cache-control", "no-store");
  if ((req.url ?? "").startsWith("/api/")) {
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: access.message }));
    return;
  }
  res.setHeader("content-type", "text/plain; charset=utf-8");
  res.end(`디바이스팜: ${access.message}`);
}

/** 관문이 정한 사용자 이름: Tailscale 계정, 팀 비밀번호 로그인 `team@<ip>`, 호스트 자신 `local` */
function userOf(req: IncomingMessage): string {
  return requestUser(req);
}

/** `test-results` 안의 실제 파일만. `..`·절대 경로·심볼릭 링크 탈출·허용 밖 확장자는 null. */
export function resolveResultFile(root: string, relative: string): { file: string; type: string } | null {
  if (!relative || path.isAbsolute(relative) || relative.includes("\0")) return null;
  const type = resultFileTypes[path.extname(relative).toLowerCase() as keyof typeof resultFileTypes];
  if (!type) return null;
  try {
    const base = realpathSync(root);
    const inside = (target: string) => target.startsWith(base + path.sep);
    const target = path.resolve(base, relative);
    if (!inside(target)) return null;
    const real = realpathSync(target);
    return inside(real) && statSync(real).isFile() ? { file: real, type } : null;
  } catch {
    // 없는 파일·루트는 404와 같다.
    return null;
  }
}

type Handler = (context: { farm: Farm; req: IncomingMessage; res: ServerResponse; url: URL; id: string }) => Promise<void>;

export const noRunToStopMessage = "멈출 점검이 없어요.";
/** 이 서버가 돌리지 않는 작업(터미널 CLI로 돈 것·이미 끝난 것) */
export const noJobToStopMessage = "여기서 멈출 수 있는 작업이 아니에요. 이미 끝났거나 터미널에서 돌고 있어요.";

async function stopRun({ farm, res }: Parameters<Handler>[0]): Promise<void> {
  if (!farm.stopRun()) return sendJson(res, 409, { error: noRunToStopMessage });
  sendJson(res, 200, { stopping: true });
}

/** 진행 중 플로팅 「중지」: body.kind = run·bot·explore·policy */
async function stopJob({ farm, req, res }: Parameters<Handler>[0]): Promise<void> {
  const body = await readBody(req);
  const kind = stoppableJobs.find((item) => item === body.kind);
  if (!kind) throw new HttpError(400, `kind는 ${stoppableJobs.join("·")} 중 하나여야 합니다.`);
  if (!farm.stopJob(kind)) return sendJson(res, 409, { error: noJobToStopMessage });
  sendJson(res, 200, { stopping: true });
}

/** 디자인 점검 경로 목록. 없으면 undefined(전부), 있으면 /로 시작하는 문자열 1개 이상 */
function parseDesignPaths(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0 || !value.every((item) => typeof item === "string" && item.startsWith("/"))) {
    throw new HttpError(400, "designPaths는 /로 시작하는 경로 목록이어야 합니다.");
  }
  return [...new Set(value as string[])];
}

async function startRun({ farm, req, res }: Parameters<Handler>[0]): Promise<void> {
  const body = await readBody(req);
  if (body.flowsOnly !== undefined && typeof body.flowsOnly !== "boolean") throw new HttpError(400, "flowsOnly는 true 또는 false여야 합니다.");
  if (body.buttonCheck !== undefined && typeof body.buttonCheck !== "boolean") throw new HttpError(400, "buttonCheck는 true 또는 false여야 합니다.");
  const flowIds = parseFlowIds(body.flowIds);
  if (body.skipInstall !== undefined && typeof body.skipInstall !== "boolean") throw new HttpError(400, "skipInstall은 true 또는 false여야 합니다.");
  // 멈춘 점검을 이어서 돌릴 때: 결과가 남은 항목은 건너뛰고, 같은 빌드가 깔려 있으면 설치하지 않는다
  const skipNames = parseSkipNames(body.skipNames);
  if (body.designOnly !== undefined && typeof body.designOnly !== "boolean") throw new HttpError(400, "designOnly는 true 또는 false여야 합니다.");
  const designPaths = parseDesignPaths(body.designPaths);
  // 화면 시나리오를 골라 돌리면 설치·플로우·데이터·정책 점검 없이 그 화면만 다시 본다
  const scenarioNames = parseScenarioNames(body.scenarioNames);
  // 디자인 화면을 골라 돌리면 설치·화면·플로우 점검 없이 그 화면만 본다(「디자인 점검」 탭)
  const designOnly = body.designOnly === true || designPaths !== undefined;
  // 플로우를 골라 돌리면 설치·화면 점검 없이 그 플로우만 돈다
  const flowsOnly = body.flowsOnly === true || flowIds !== undefined;
  // 플로우만 돌릴 때는 설치하지 않으니 버전을 받지 않는다.
  const version = flowsOnly || designOnly || scenarioNames ? installedVersionLabel : nonEmptyString(body.version, "version");
  const request = {
    kind: parseKind(body.kind),
    version,
    deviceIds: parseDevices(body.devices),
    flowsOnly,
    flowIds,
    buttonCheck: body.buttonCheck === true,
    ...(skipNames?.length ? { skipNames, label: "기기 점검 (이어서)" } : {}),
    ...(body.skipInstall === true ? { skipInstall: true } : {}),
    ...(scenarioNames ? { scenarioNames, label: `화면 다시 점검 · ${scenarioNames.length}개` } : {}),
    ...(designOnly ? { designOnly, designPaths, label: designPaths?.length === 1 ? `디자인 점검 · ${designPaths[0]}` : "디자인 점검" } : {}),
  };
  const started = farm.startRun(request);
  if (!started.ok) return sendJson(res, 409, { error: started.error });
  sendJson(res, 202, { runId: started.runId, position: started.position });
}

async function runOne({ farm, url, res }: Parameters<Handler>[0]): Promise<void> {
  const run = farm.runById(url.searchParams.get("id") ?? "");
  if (!run) return sendJson(res, 404, { error: "점검 기록을 찾지 못했어요." });
  sendJson(res, 200, run);
}

async function startBot({ farm, res }: Parameters<Handler>[0]): Promise<void> {
  const started = farm.startBot();
  if (!started.ok) return sendJson(res, 409, { error: started.error });
  sendJson(res, 202, { started: started.runId, position: started.position });
}

const issueStatuses = ["checking", "done", "not-issue"] as const;

/** 「문제」 화면에서 상태 바꾸기. 슬랙 메시지도 같이 고친다 */
async function setIssueStatus({ farm, req, res }: Parameters<Handler>[0]): Promise<void> {
  const body = await readBody(req);
  const key = nonEmptyString(body.key, "key");
  const status = issueStatuses.find((item) => item === body.status);
  if (!status) throw new HttpError(400, "status는 checking·done·not-issue 중 하나여야 합니다.");
  if (!(await farm.setIssueStatus(key, status))) return sendJson(res, 404, { error: "모르는 문제예요." });
  sendJson(res, 200, { ok: true });
}

async function startExplore({ farm, req, res }: Parameters<Handler>[0]): Promise<void> {
  const body = await readBody(req);
  // 운영 빌드 요청은 잠금·기기 목록에 손대기 전에 돌려보낸다.
  if (body.build === "prod") return sendJson(res, 400, { error: prodExploreMessage });
  if (body.build !== undefined && body.build !== "dev") throw new HttpError(400, "build는 dev만 받습니다.");
  const started = farm.startExplore({ deviceIds: parseDevices(body.devices) });
  if (!started.ok) return sendJson(res, 409, { error: started.error });
  sendJson(res, 202, { runId: started.runId, position: started.position });
}

/** 대기열에서 기다리는 작업 빼기. body.id = GET /queue의 pending[].id */
async function cancelQueued({ farm, req, res }: Parameters<Handler>[0]): Promise<void> {
  const id = nonEmptyString((await readBody(req)).id, "id");
  if (!farm.cancelQueued(id)) return sendJson(res, 404, { error: notQueuedMessage });
  sendJson(res, 200, { canceled: true });
}

async function replay({ farm, req, res }: Parameters<Handler>[0]): Promise<void> {
  const body = await readBody(req);
  const input = { runId: nonEmptyString(body.runId, "runId"), deviceId: nonEmptyString(body.deviceId, "deviceId"), pathId: nonEmptyString(body.pathId, "pathId") };
  sendJson(res, 200, await farm.replay(input));
}

async function confirmBaselines({ farm, req, res }: Parameters<Handler>[0]): Promise<void> {
  const names = parseNames((await readBody(req)).names);
  if (farm.isBusy()) return sendJson(res, 409, { error: baselineBusyMessage });
  sendJson(res, 200, { confirmed: farm.confirmBaselines(names) });
}

/** 플로우 화면 한 번에 필요한 것: 후보, 확정, 고를 수 있는 PRD, 생성 가능 여부. */
function flowsState() {
  return { candidates: readCandidates(), ready: readReady(), prds: listPrds(), prdRootSet: prdRoot() !== null, llmConfigured: llmConfigured() };
}

async function generateFlows({ farm, req, res }: Parameters<Handler>[0]): Promise<void> {
  const result = await generateFromPrd(farm.app, nonEmptyString((await readBody(req)).prd, "prd"));
  if (!result.ok) return sendJson(res, result.status, { error: result.error });
  sendJson(res, 200, result);
}

async function confirmFlowCandidates({ farm, req, res }: Parameters<Handler>[0]): Promise<void> {
  const ids = parseNames((await readBody(req)).ids);
  // 점검 중에 확정하면 이번 실행의 플로우 목록과 화면이 어긋난다.
  if (farm.isBusy()) return sendJson(res, 409, { error: flowBusyMessage });
  sendJson(res, 200, { confirmed: confirmFlows(ids) });
}

/** 화면 지도 조립 결과를 후보로. 서버가 지도 위에서 스텝을 다시 밟아 본다(화면이 보낸 스텝을 그대로 믿지 않는다). */
async function mapFlowCandidate({ farm, res, req }: Parameters<Handler>[0]): Promise<void> {
  const body = await readBody(req);
  const name = nonEmptyString(body.name, "name");
  const steps = stepsOf(body.steps, farm.app.guard.forbiddenClickNames);
  if (typeof steps === "string") throw new HttpError(400, steps);
  const error = mapFlowError(readScreenMap().edges, steps, mapRulesOf(farm.app));
  if (error) throw new HttpError(400, error);
  // 같은 스텝이면 같은 id. 이미 확정된 플로우와 겹치면 수정 제안이 된다.
  const id = `map-${prdHash(JSON.stringify(steps)).slice(0, mapFlowIdHashLength)}`;
  const proposal = readReady().some((flow) => flow.id === id) ? "update" : "create";
  const requirement = `화면 지도에서 블록 ${steps.length}개를 이어 붙임`;
  const flow: FlowDocument = { id, name, source: "map_built", status: "generated", prd: mapFlowPrd, requirement, proposal, steps };
  addCandidate(flow);
  sendJson(res, 200, { id });
}

async function candidate({ farm, res, url }: Parameters<Handler>[0]): Promise<void> {
  const png = farm.candidatePng(url.searchParams.get("name") ?? "");
  if (!png) return sendJson(res, 404, { error: "후보 화면이 없습니다." });
  sendFile(res, "image/png", png);
}

/** 정책 바뀜 감지를 지금 돌린다. 토큰이 없거나 이미 도는 중이면 409 */
async function checkPolicy({ farm, res }: Parameters<Handler>[0]): Promise<void> {
  const state = farm.policyState();
  if (!state?.configured) return sendJson(res, 409, { error: "CONFLUENCE_EMAIL·CONFLUENCE_API_TOKEN이 없어 정책을 확인할 수 없습니다." });
  if (!farm.checkPolicy()) return sendJson(res, 409, { error: "이미 정책을 확인하는 중입니다." });
  sendJson(res, 202, { started: true });
}

/** 정책 규칙·피그마 문구 차이를 무시한다. 그때의 해시에 묶여 정책·노드가 바뀌면 풀린다(설계 문서 「무시」) */
async function ignorePolicy({ req, res }: Parameters<Handler>[0]): Promise<void> {
  const body = await readBody(req);
  const key = nonEmptyString(body.key, "key");
  const hash = typeof body.hash === "string" ? body.hash : "";
  addIgnore({ key, hash, reason: nonEmptyString(body.reason, "reason"), at: new Date().toISOString() });
  sendJson(res, 200, { items: readIgnores() });
}

async function unignorePolicy({ req, res }: Parameters<Handler>[0]): Promise<void> {
  const body = await readBody(req);
  removeIgnore(nonEmptyString(body.key, "key"), typeof body.hash === "string" ? body.hash : "");
  sendJson(res, 200, { items: readIgnores() });
}

/** 카오스 실행 하나. 진행 중이면 지금까지의 스텝 */
async function chaosRun({ res, url }: Parameters<Handler>[0]): Promise<void> {
  const run = readChaosRun(url.searchParams.get("id") ?? "");
  if (!run) return sendJson(res, 404, { error: "봇 점검 실행이 없습니다." });
  sendJson(res, 200, run);
}

async function botSummary({ res, url }: Parameters<Handler>[0]): Promise<void> {
  sendJson(res, 200, readBotSummary(url.searchParams.get("id") ?? ""));
}

/** 봇 점검 원인 한 줄 요약을 지금 만든다(예전 실행·요약 실패 때). Claude가 1~2분 걸릴 수 있다 */
async function summarizeBot({ farm, req, res }: Parameters<Handler>[0]): Promise<void> {
  const body = await readBody(req);
  const summary = await summarizeBotRun(nonEmptyString(body.id, "id"), undefined, farm.app.name);
  if (!summary) return sendJson(res, 404, { error: "봇 점검 실행이 없습니다." });
  sendJson(res, 200, summary);
}

async function resultFile({ farm, res, url }: Parameters<Handler>[0]): Promise<void> {
  const found = resolveResultFile(farm.resultsRoot, url.searchParams.get("path") ?? "");
  if (!found) return sendJson(res, 404, { error: "파일이 없습니다." });
  sendFile(res, found.type, readFileSync(found.file));
}

function ownsLock(farm: Farm, id: string, user: string): boolean {
  const owner = farm.locks.ownerOf(id);
  return owner?.kind === "user" && owner.user === user;
}

async function input({ farm, req, res, id }: Parameters<Handler>[0]): Promise<void> {
  if (!ownsLock(farm, id, userOf(req))) return sendJson(res, 423, { error: noLockMessage });
  const event = parseInputEvent(await readBody(req));
  if (!event) throw new HttpError(400, "입력 형식이 올바르지 않습니다.");
  const platform = await farm.platformOf(id);
  if (!platform) throw new HttpError(404, "연결된 기기가 아닙니다.");
  if (platform === "ios" && event.type === "key" && event.key === "back") throw new HttpError(400, iosBackUnsupported);
  farm.locks.touch(id);
  await farm.sendInput(id, platform, event);
  sendJson(res, 200, { ok: true });
}

async function lock({ farm, req, res, id }: Parameters<Handler>[0]): Promise<void> {
  const user = userOf(req);
  const already = ownsLock(farm, id, user);
  if (!farm.locks.acquire(id, { kind: "user", user })) {
    const owner = farm.locks.ownerOf(id);
    return sendJson(res, 409, { error: owner?.kind === "user" ? `${owner.user}님이 조작 중입니다.` : botLockMessage });
  }
  if (!already) farm.recordControl({ user, deviceId: id, action: "lock" });
  sendJson(res, 200, { ok: true });
}

async function unlock({ farm, req, res, id }: Parameters<Handler>[0]): Promise<void> {
  const user = userOf(req);
  if (ownsLock(farm, id, user)) {
    farm.locks.release(id, { kind: "user", user });
    farm.recordControl({ user, deviceId: id, action: "release" });
  }
  sendJson(res, 200, { ok: true });
}

async function touch({ farm, req, res, id }: Parameters<Handler>[0]): Promise<void> {
  const locked = ownsLock(farm, id, userOf(req));
  if (locked) farm.locks.touch(id);
  sendJson(res, 200, { ok: true, locked });
}

async function mjpeg({ farm, req, res, id }: Parameters<Handler>[0]): Promise<void> {
  if ((await farm.platformOf(id)) !== "ios") throw new HttpError(404, "연결된 iOS 기기가 아닙니다.");
  await farm.ensureIosSession?.(id);
  // ponytail: WDA MJPEG 포트(9100)가 하나라 iOS 기기 한 대 기준이다. 여러 대면 기기별 포트 포워딩이 필요하다.
  const upstream = httpGet(farm.mjpegUrl, (source) => {
    res.statusCode = source.statusCode ?? 502;
    res.setHeader("content-type", source.headers["content-type"] ?? "multipart/x-mixed-replace");
    res.setHeader("cache-control", "no-store");
    source.pipe(res);
  });
  upstream.on("error", (error) => {
    if (!res.headersSent) sendJson(res, 502, { error: `iOS 화면을 못 받았습니다: ${error.message}` });
    else res.destroy();
  });
  req.on("close", () => upstream.destroy());
}

async function streamOverHttp({ res }: Parameters<Handler>[0]): Promise<void> {
  sendJson(res, 426, { error: "WebSocket으로 연결해 주세요." });
}

const json = (load: (farm: Farm) => unknown | Promise<unknown>): Handler => async ({ farm, res }) => sendJson(res, 200, await load(farm));

const fixedRoutes: Record<string, Handler> = {
  "GET /": json((farm) => farm.listDevices()),
  "GET /app": json((farm) => publicAppConfig(farm.app)),
  "POST /run": startRun,
  "POST /run/stop": stopRun,
  "POST /jobs/stop": stopJob,
  "GET /queue": json((farm) => farm.jobQueue()),
  "POST /queue/cancel": cancelQueued,
  "GET /runs/latest": json((farm) => farm.latestRun()),
  "GET /runs": json((farm) => farm.runSummaries()),
  "GET /runs/one": runOne,
  "GET /design": json((farm) => farm.designPages()),
  "GET /baselines/pending": json((farm) => farm.pendingBaselines()),
  "GET /baselines/candidate": candidate,
  "POST /baselines/confirm": confirmBaselines,
  "POST /explore": startExplore,
  "GET /explore/latest": json((farm) => farm.latestExplore()),
  "POST /explore/replay": replay,
  "GET /files": resultFile,
  "GET /flows": json(() => flowsState()),
  "POST /flows/generate": generateFlows,
  "POST /flows/confirm": confirmFlowCandidates,
  "POST /flows/from-map": mapFlowCandidate,
  "GET /screen-map": json(() => readScreenMap()),
  "GET /chaos": json(() => listChaosRuns()),
  "GET /policy": json((farm) => farm.policyState()),
  "POST /policy/check": checkPolicy,
  "GET /policy/ignored": json(() => ({ items: readIgnores() })),
  "POST /policy/ignore": ignorePolicy,
  "POST /policy/unignore": unignorePolicy,
  "GET /chaos/run": chaosRun,
  "POST /chaos/start": startBot,
  "GET /chaos/summary": botSummary,
  "POST /chaos/summary": summarizeBot,
  "GET /issues": json((farm) => farm.issues()),
  "POST /issues/status": setIssueStatus,
  "GET /daily/latest": json((farm) => farm.latestDailyReport()),
};

const deviceRoutes: Record<string, Handler> = {
  "POST input": input,
  "POST lock": lock,
  "DELETE lock": unlock,
  "POST lock/touch": touch,
  "GET mjpeg": mjpeg,
  "GET stream": streamOverHttp,
};

const devicePathPattern = /^\/([^/]+)\/(input|lock|lock\/touch|mjpeg|stream)$/;

function findRoute(method: string, rest: string): { handler: Handler; id: string } | null {
  const fixed = fixedRoutes[`${method} ${rest || "/"}`];
  if (fixed) return { handler: fixed, id: "" };
  const match = devicePathPattern.exec(rest);
  const handler = match ? deviceRoutes[`${method} ${match[2]}`] : undefined;
  return match && handler ? { handler, id: decodeURIComponent(match[1]) } : null;
}

function statusOf(error: unknown): number {
  if (error instanceof HttpError || error instanceof ExploreRequestError) return error.status;
  return 500;
}

/** `/api/devices/*` connect 미들웨어. 실패는 모두 `{ error }`. */
export function deviceMiddleware(farm: Farm) {
  return (req: IncomingMessage, res: ServerResponse, next: Next): void => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname !== apiPrefix && !url.pathname.startsWith(`${apiPrefix}/`)) return next();
    const route = findRoute(req.method ?? "GET", url.pathname.slice(apiPrefix.length).replace(/\/$/, ""));
    if (!route) return sendJson(res, 404, { error: "없는 API입니다." });
    route.handler({ farm, req, res, url, id: route.id }).catch((error: unknown) => {
      if (!res.headersSent) sendJson(res, statusOf(error), { error: errorMessage(error) });
    });
  };
}

const streamPathPattern = /^\/api\/devices\/([^/]+)\/stream$/;

/** `/api/devices/:id/stream`이면 id, 아니면 null(Vite HMR 등 다른 업그레이드는 건드리지 않는다). */
export function streamIdOf(rawUrl: string | undefined): string | null {
  const match = streamPathPattern.exec(new URL(rawUrl ?? "/", "http://127.0.0.1").pathname);
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * 보내고 못 나간 바이트가 이보다 많으면 다음 키프레임까지 건너뛴다 (작성자 판단: 4Mbps 약 1초).
 * 와이파이가 느린 PC는 쌓인 프레임을 다 받느라 화면이 점점 늦어지고 멈춘 것처럼 보였다(2026-11-17).
 */
export const streamMaxBufferedBytes = 512 * 1024;
/** 끊긴 줄 모르는 연결(와이파이 절전·공유기)을 찾는 핑 간격 (작성자 판단). 두 번 연속 답이 없으면 닫는다 */
export const streamPingMs = 15_000;

/** 키프레임까지 건너뛰기. 늦은 화면은 오래된 프레임 대신 다음 키프레임부터 다시 그린다 */
export function createPacketGate(buffered: () => number, maxBuffered = streamMaxBufferedBytes) {
  let skipping = false;
  return (key: boolean): boolean => {
    if (buffered() > maxBuffered) skipping = true;
    if (!skipping) return true;
    if (!key || buffered() > maxBuffered) return false;
    skipping = false;
    return true;
  };
}

/** 첫 메시지 JSON `{ codec, width, height }`, 그 뒤 H.264 패킷(바이너리). */
async function attachStream(farm: Farm, id: string, socket: WebSocket): Promise<void> {
  let unsubscribe: (() => void) | null = null;
  let alive = true;
  socket.on("pong", () => {
    alive = true;
  });
  const ping = setInterval(() => {
    if (!alive) {
      socket.terminate();
      return;
    }
    alive = false;
    socket.ping();
  }, streamPingMs);
  socket.on("close", () => {
    clearInterval(ping);
    unsubscribe?.();
  });
  const pass = createPacketGate(() => socket.bufferedAmount);
  try {
    if ((await farm.platformOf(id)) !== "android") throw new Error("Android 기기만 스트림을 보냅니다. iOS는 mjpeg를 쓰세요.");
    const stop = await farm.watchVideo(id, {
      header: (header) => socket.send(JSON.stringify(header)),
      packet: (packet, key) => {
        if (socket.readyState === WebSocket.OPEN && pass(key)) socket.send(packet);
      },
    });
    if (socket.readyState === WebSocket.OPEN) unsubscribe = stop;
    else stop();
  } catch (error) {
    socket.close(1011, errorMessage(error).slice(0, closeReasonLength));
  }
}

/**
 * 디바이스팜 서버. farm을 안 주면 앱 설정(`app`)으로 진짜 기기 구성을 만들고
 * 시작 작업(재시작 복구·보관 정리·iOS 세션·자동 점검)을 돈다.
 * 관문: `.env` `FARM_PASSWORD_HASH`가 있으면 팀 비밀번호 로그인(`auth/`), 없으면 Tailscale 계정·로컬 접속(`access.ts`).
 */
export function devicePlugin(options: { app: AppConfig; farm?: Farm; gate?: AuthGate }): Plugin {
  const { app, farm } = options;
  return {
    name: "device-farm-devices",
    configureServer: attach,
    // `npx device-farm dev`는 미리 빌드한 화면을 vite preview로 연다. API·스트림은 dev와 똑같이 붙인다.
    configurePreviewServer: attach,
  };

  function attach(server: Pick<ViteDevServer | PreviewServer, "middlewares" | "httpServer">): void {
    const running = farm ? null : createFarm({ app });
    const active = farm ?? running;
    if (!active) return;
    void running?.start().catch((error: unknown) => console.error(`[farm] 시작 실패: ${errorMessage(error)}`));
    const gate = options.gate ?? (process.env.FARM_PASSWORD_HASH?.trim() ? createAuthGate({ sessions: dbSessionStore(farmDb()) }) : null);
    const stopGate = gate?.start();
    const domains = allowedDomains(undefined, app.access.allowedDomains);
    // 플러그인 configureServer는 Vite 내부 미들웨어보다 먼저 붙는다. 화면 파일·로그인 API까지 이 관문을 지난다.
    server.middlewares.use(gate ? gate.middleware : createAccessMiddleware(domains));
    server.middlewares.use(deviceMiddleware(active));
    const sockets = new WebSocketServer({ noServer: true });
    server.httpServer?.on("upgrade", (req, socket, head) => {
      const id = streamIdOf(req.url);
      // 팀 비밀번호를 켜면 사내망에 열리므로 스트림만이 아니라 모든 업그레이드(Vite HMR 포함)를 본다
      if (!gate && id === null) return;
      const access = gate ? gate.upgrade(req) : decideAccess({ remoteAddress: req.socket.remoteAddress, headers: req.headers }, domains);
      if (!access.ok) {
        socket.end(upgradeRefusal(access));
        return;
      }
      if (id === null) return;
      if (!gate) setRequestUser(req, access.user);
      sockets.handleUpgrade(req, socket, head, (ws) => void attachStream(active, id, ws));
    });
    server.httpServer?.on("close", () => {
      stopGate?.();
      sockets.close();
      void running?.stop();
    });
  }
}

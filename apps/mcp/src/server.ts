// 디바이스팜 기기 MCP 서버(stdio). Claude Code가 이 도구로 Android dev 앱을 탐색한다(사용자 Claude 계정, API 키 불필요).
// 등록: 레포 루트 .mcp.json(디바이스팜 폴더에서 Claude Code를 열면 쓴다) 또는 플러그인(.claude-plugin). 직접 돌릴 때는 npm run device-mcp
// 앱 설정: FARM_CONFIG → Claude Code를 연 폴더의 farm.config.ts → 디바이스팜 루트의 farm.config.ts → farm.config.example.ts
// 안전: 금지 버튼은 목록에서 빼고 거절한다. 허용 목록 밖 쓰기 요청은 가드가 막는다(가드를 못 걸면 시작하지 않는다).
// stdout은 MCP 프로토콜 전용이라 로그는 stderr로만 쓴다.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { createDeviceSession, defaultMaxActions, type DeviceSession } from "@device-farm/core/agent/device-session";
import { stepsOf, type FlowDocument } from "@device-farm/core/flows/schema";
import { mapRulesOf } from "@device-farm/core/flows/map-flow";
import { buildRecording } from "@device-farm/core/record/recording";
import { openAndroidDriver, type AndroidScreenDriver } from "@device-farm/devices/android-driver";
import { execFileText } from "@device-farm/devices/exec";
import { listDevices } from "@device-farm/devices/registry";
import { defaultGuard } from "@device-farm/engine/explore/run";
import { addCandidate, readReady } from "@device-farm/engine/flows/store";
import { recordScreenMap } from "@device-farm/engine/screen-map-store";
import { loadAppConfig, resolveAppConfigFile } from "@device-farm/server/app-config";
import { loadDotEnv, webOrigin } from "@device-farm/server/env";
import { loadExploreInputs } from "@device-farm/server/explore";

const agentIdHashLength = 8;

// 사용자 프로젝트(Claude Code를 연 폴더)의 farm.config.ts를 먼저 본다. 그다음 디바이스팜 루트 기준으로 .env·test-results를 쓴다.
const userProject = process.cwd();
// npm 패키지(`npx device-farm mcp`)로 돌면 bin이 FARM_ROOT를 사용자 프로젝트로 넘긴다
const farmRoot = process.env.FARM_ROOT ?? path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");
const userConfig = path.join(userProject, "farm.config.ts");
const configFile = process.env.FARM_CONFIG ? resolveAppConfigFile(process.env, userProject) : existsSync(userConfig) ? userConfig : resolveAppConfigFile(process.env, farmRoot);
process.chdir(farmRoot);
loadDotEnv();
const app = await loadAppConfig(configFile, (line) => console.error(line));
const farmRunsUrl = `http://127.0.0.1:${Number(process.env.FARM_PORT) || 5173}/api/devices/runs/latest`;

interface Active {
  task: string;
  driver: AndroidScreenDriver;
  session: DeviceSession;
  unguard: () => Promise<void>;
}

let active: Active | null = null;

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };
const text = (value: unknown): ToolResult => ({ content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 1) }] });
const failure = (error: unknown): ToolResult => ({ ...text(error instanceof Error ? error.message : String(error)), isError: true });

function requireActive(): Active {
  if (!active) throw new Error("탐색이 시작되지 않았습니다. device_start부터 부르세요.");
  return active;
}

async function guarded(work: () => Promise<unknown>): Promise<ToolResult> {
  try {
    return text(await work());
  } catch (error) {
    return failure(error);
  }
}

/** 디바이스팜 점검이 도는 중이면 같은 기기를 같이 만지지 않는다. 서버가 꺼져 있으면 확인 없이 진행한다. */
async function farmBusy(): Promise<boolean> {
  const response = await fetch(farmRunsUrl).catch(() => null);
  if (!response?.ok) return false;
  const run = (await response.json().catch(() => null)) as { finishedAt?: string | null } | null;
  return Boolean(run && run.finishedAt === null);
}

async function start(task: string, deviceId: string | undefined, maxActions: number): Promise<unknown> {
  if (active) throw new Error(`이미 탐색 중입니다: ${active.task}. device_finish로 끝낸 뒤 시작하세요.`);
  if (await farmBusy()) throw new Error("디바이스팜 점검이 도는 중이라 기기를 쓸 수 없습니다.");
  const devices = (await listDevices(execFileText, app.appIds.dev)).filter((device) => device.platform === "android");
  const device = deviceId ? devices.find((item) => item.id === deviceId) : devices[0];
  if (!device) throw new Error(deviceId ? `연결된 Android 기기가 아닙니다: ${deviceId}` : "연결된 Android 기기가 없습니다. iOS는 쓰기 요청 차단이 없어 아직 탐색하지 않습니다.");
  const origin = webOrigin(app, "dev");
  const driver = await openAndroidDriver(device.id, app.appIds.dev, origin, app);
  const blocked: string[] = [];
  const unguard = await defaultGuard(driver, origin, loadExploreInputs().allowlist, (request) => blocked.push(`${request.method} ${request.path}`)).catch(async (error: unknown) => {
    await driver.close();
    throw error;
  });
  const session = createDeviceSession(driver, { maxActions, takeBlocked: () => blocked.splice(0) });
  active = { task, driver, session, unguard };
  if (!driver.goHome) throw new Error("홈으로 갈 수 없는 드라이버입니다.");
  await driver.goHome();
  return { device: `${device.model} (${device.id})`, task, maxActions, screen: await session.look() };
}

async function finish(summary: string): Promise<unknown> {
  const { task, driver, session, unguard } = requireActive();
  active = null;
  try {
    const recording = buildRecording(session.events, app.homePath, mapRulesOf(app));
    for (const screen of recording.screens) recordScreenMap(screen.from, screen.buttons);
    const dir = path.resolve("test-results/agent", new Date().toISOString().replace(/[:.]/g, "-"));
    mkdirSync(dir, { recursive: true });
    const findings = session.findings.map((finding, index) => {
      const screenshot = finding.screenshot ? `finding-${index + 1}.png` : undefined;
      if (finding.screenshot && screenshot) writeFileSync(path.join(dir, screenshot), finding.screenshot);
      return { path: finding.path, description: finding.description, screenshot };
    });
    writeFileSync(path.join(dir, "report.json"), `${JSON.stringify({ task, summary, actions: session.actions(), findings, events: session.events, cut: recording.cut }, null, 2)}\n`);

    const steps = stepsOf(recording.steps, app.guard.forbiddenClickNames);
    let candidate: string;
    if (typeof steps === "string") {
      candidate = `플로우 후보로 올리지 않음: ${recording.cut ?? steps}`;
    } else {
      const id = `agent-${createHash("sha256").update(JSON.stringify(steps)).digest("hex").slice(0, agentIdHashLength)}`;
      const proposal = readReady().some((flow) => flow.id === id) ? "update" : "create";
      const flow: FlowDocument = { id, name: `탐색: ${task}`, source: "recorded", status: "generated", prd: "에이전트 탐색", requirement: task, proposal, steps };
      addCandidate(flow);
      candidate = `플로우 후보 「${flow.name}」(${id})를 올렸습니다. 디바이스팜 플로우 탭에서 확정할 수 있습니다.`;
    }
    return { report: path.relative(process.cwd(), path.join(dir, "report.json")), actions: session.actions(), findings, mapScreens: recording.screens.length, candidate };
  } finally {
    await unguard().catch(() => undefined);
    await driver.close().catch(() => undefined);
  }
}

const server = new McpServer({ name: "device-farm", version: "0.1.0" });
const roleSchema = z.enum(["button", "link"]);

server.registerTool(
  "device_start",
  {
    description:
      `${app.name} Android dev 앱 탐색을 시작한다. 쓰기 요청 차단을 켜고 홈 탭(${app.homeTabName})으로 간 뒤 화면을 돌려준다. 구매·결제·출금·신청·탈퇴 같은 버튼은 목록에서 빠지고 눌러도 거절된다. 끝나면 반드시 device_finish를 부른다.`,
    inputSchema: {
      task: z.string().describe("탐색 목표. 예: 퀴즈 화면을 나갔다 다시 들어올 때 상태가 유지되는지"),
      device: z.string().optional().describe("Android serial. 없으면 연결된 첫 기기"),
      maxActions: z.number().int().positive().optional().describe(`누르기·홈 이동 최대 횟수 (기본 ${defaultMaxActions})`),
    },
  },
  async ({ task, device, maxActions }) => guarded(() => start(task, device, maxActions ?? defaultMaxActions)),
);

server.registerTool(
  "device_look",
  { description: "지금 화면의 경로, 제목·팝업 문구, 경고(앱 오류·로그인 튕김·막은 쓰기 요청), 누를 수 있는 버튼·링크 목록, 남은 횟수를 본다." },
  async () => guarded(() => requireActive().session.look()),
);

server.registerTool(
  "device_press",
  {
    description: "마지막 device_look 목록에 있는 버튼·링크를 이름 그대로 누른다. 누른 뒤 화면을 돌려준다.",
    inputSchema: { role: roleSchema, name: z.string().describe("목록의 name을 글자 그대로") },
  },
  async ({ role, name }) => guarded(() => requireActive().session.press(role, name)),
);

server.registerTool(
  "device_go_home",
  { description: `열린 화면을 모두 닫고 홈(${app.homeTabName} 탭)으로 간다. 막혔거나 처음부터 다시 해 볼 때 쓴다.` },
  async () => guarded(() => requireActive().session.goHome()),
);

server.registerTool(
  "device_report_issue",
  {
    description: "지금 화면에서 버그로 보이는 것을 스크린샷과 같이 남긴다. 무엇을 했더니 무엇이 이상했는지 구체적으로 쓴다. 디자인 취향은 남기지 않는다.",
    inputSchema: { description: z.string() },
  },
  async ({ description }) => guarded(async () => (await requireActive().session.reportIssue(description), "기록했습니다.")),
);

server.registerTool(
  "device_finish",
  {
    description: "탐색을 끝낸다. 화면 지도에 합치고, 홈부터 다시 돌 수 있으면 플로우 후보로 올리고, 이상 후보·스크린샷을 보고서로 남긴다.",
    inputSchema: { summary: z.string().describe("한 일과 찾은 것 요약") },
  },
  async ({ summary }) => guarded(() => finish(summary)),
);

// 연결이 끊기면 가드를 풀고 드라이버를 닫는다.
process.stdin.on("close", () => {
  if (active) void finish("연결이 끊겨 끝냄").catch((error: unknown) => console.error(error));
});

await server.connect(new StdioServerTransport());
console.error("[device-farm] MCP 서버 준비됨");

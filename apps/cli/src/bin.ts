#!/usr/bin/env node
// npm 패키지 실행 파일: `npx device-farm <명령>`. 명령마다 기존 CLI 모듈을 불러 실행한다.
// 사용자 farm.config.ts(TypeScript)를 읽어야 해서 tsx 로더를 먼저 건다.
import { register } from "tsx/esm/api";

import { defaultPort } from "./args";

interface Command {
  usage: string;
  summary: string;
  run: () => Promise<unknown>;
}

const commands: Record<string, Command> = {
  init: { usage: "init", summary: "farm.config.ts·.env.example을 만든다(있으면 건너뜀)", run: async () => (await import("./init")).init() },
  dev: { usage: "dev [--port 5173]", summary: "디바이스팜 화면·API 서버를 연다(127.0.0.1)", run: runDev },
  check: {
    usage: "check --build dev|prod --version 2.1.5 [--devices all|id,id] [--port 5173]",
    summary: "기준 화면 비교·버튼 눌러보기 점검(dev 서버가 떠 있어야 한다)",
    run: () => import("./device-run"),
  },
  explore: { usage: "explore [--devices all|id,id] [--build dev] [--port 5173]", summary: "화면 탐색(dev 서버가 떠 있어야 한다)", run: () => import("./device-explore") },
  chaos: {
    usage: "chaos --device <Android serial> [--seed 42] [--episodes 3] [--steps 50] [--minutes 60] [--no-guard]",
    summary: "카오스 탐색. --no-guard는 쓰기 요청을 막지 않는다(dev 서버 전용)",
    run: () => import("./chaos"),
  },
  record: { usage: 'record --device <Android serial> [--seconds 300] [--name "플로우 이름"]', summary: "사람 조작을 녹화해 화면 지도·플로우 후보로", run: () => import("./record") },
  qa: { usage: "qa --device <id> [--path /home]", summary: "화면 데이터 QA(API 응답 ↔ 화면 글자)", run: () => import("./qa-run") },
  "policy-watch": { usage: "policy-watch [--extract <pageId>] [--figma]", summary: "Confluence 정책 바뀜 감지·규칙 뽑기·피그마 캐시", run: () => import("./policy-watch") },
  "policy-check": { usage: "policy-check --device <id> [--path /my/orders]", summary: "정책·피그마 대조를 기기 한 대에서", run: () => import("./policy-check") },
  "explore-allowlist": { usage: "explore-allowlist", summary: "FARM_OPENAPI_URL 스펙의 쓰기 API를 explore/allowlist.json에 deny로 추가", run: () => import("./explore-allowlist") },
  mcp: { usage: "mcp", summary: "Claude Code용 MCP 서버(stdio)", run: runMcp },
};

function usage(): string {
  const width = Math.max(...Object.keys(commands).map((name) => name.length));
  const lines = Object.entries(commands).map(([name, command]) => `  ${name.padEnd(width)}  ${command.summary}`);
  return `사용법: device-farm <명령> [옵션]\n\n명령\n${lines.join("\n")}\n\n명령별 옵션: device-farm <명령> --help\n앱 설정: FARM_CONFIG → ./farm.config.ts → ./farm.config.example.ts, 비밀 값: ./.env`;
}

async function runDev(): Promise<void> {
  const index = process.argv.indexOf("--port");
  const raw = index >= 0 ? process.argv[index + 1] : process.env.FARM_PORT;
  const port = raw ? Number(raw) : defaultPort;
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error(`--port는 1~65535 정수여야 합니다: ${raw}`);
  // check·explore·chaos가 같은 포트로 서버를 찾는다
  process.env.FARM_PORT = String(port);
  await (await import("./serve")).serve(port);
}

async function runMcp(): Promise<void> {
  // 결과·.env·설정은 사용자 프로젝트(Claude Code를 연 폴더) 기준
  process.env.FARM_ROOT ??= process.cwd();
  await import("../../mcp/src/server");
}

async function main(): Promise<void> {
  const [name, ...rest] = process.argv.slice(2);
  if (!name || name === "--help" || name === "-h" || name === "help") {
    console.log(usage());
    return;
  }
  const command = commands[name];
  if (!command) {
    console.error(`알 수 없는 명령입니다: ${name}\n\n${usage()}`);
    process.exitCode = 1;
    return;
  }
  if (rest.includes("--help") || rest.includes("-h")) {
    console.log(`사용법: device-farm ${command.usage}\n\n${command.summary}`);
    return;
  }
  // 각 CLI는 process.argv.slice(2)를 자기 옵션으로 읽는다
  process.argv.splice(2, 1);
  register();
  await command.run();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

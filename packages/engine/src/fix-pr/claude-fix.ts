import { spawn } from "node:child_process";

import { ClaudeError } from "../policy/claude";

/**
 * 레포를 고치는 Claude Code(`claude -p`). 작업 폴더는 레포 작업 트리, 도구는 읽기·찾기·고치기만(Bash 없음).
 * 이 맥에 로그인한 Claude Code를 쓴다(.env `CLAUDE_CODE_OAUTH_TOKEN`, 아침 분석과 같다).
 */

/** 한 번 고치는 데 기다리는 시간 (작성자 판단) */
export const fixClaudeTimeoutMs = 15 * 60_000;

export const fixClaudeTools = "Read,Glob,Grep,Edit,Write";

export type ClaudeFix = (input: { cwd: string; prompt: string; addDirs: string[] }) => Promise<string>;

export function claudeFixArgs(addDirs: readonly string[]): string[] {
  return ["-p", "--output-format", "json", "--tools", fixClaudeTools, "--allowedTools", fixClaudeTools, "--permission-mode", "acceptEdits", ...addDirs.flatMap((dir) => ["--add-dir", dir])];
}

export const runClaudeFix: ClaudeFix = ({ cwd, prompt, addDirs }) =>
  new Promise((resolve, reject) => {
    const child = spawn("claude", claudeFixArgs(addDirs), { cwd, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new ClaudeError(`Claude가 ${fixClaudeTimeoutMs / 60_000}분 안에 끝나지 않았어요.`));
    }, fixClaudeTimeoutMs);
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(new ClaudeError(`claude 실행 실패: ${error.message}`));
    });
    child.on("close", () => {
      clearTimeout(timer);
      try {
        const parsed = JSON.parse(stdout) as { is_error?: boolean; result?: string };
        if (parsed.is_error || typeof parsed.result !== "string") throw new ClaudeError(parsed.result ?? "Claude 응답이 비었어요.");
        resolve(parsed.result);
      } catch (error) {
        reject(error instanceof ClaudeError ? error : new ClaudeError(`Claude 응답을 읽지 못했어요: ${(stderr || stdout).slice(0, 200)}`));
      }
    });
    child.stdin.end(prompt);
  });

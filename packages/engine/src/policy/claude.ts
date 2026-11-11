import { spawn } from "node:child_process";

/**
 * 정책 뽑기·판정에 쓰는 Claude. 이 Mac에 로그인한 Claude Code(`claude -p`)를 부른다(사용자 Claude 계정, API 키 불필요).
 * 로그인이 풀리면 `claude auth login`으로 다시 로그인한다.
 */

/** 한 번 묻는 데 기다리는 시간 (작성자 판단, 긴 통합 정책 뽑기가 1~2분) */
export const claudeTimeoutMs = 5 * 60_000;

export interface AskOptions {
  /** 스크린샷을 읽게 Read 도구를 허용한다 */
  allowRead?: boolean;
}

export type AskClaude = (prompt: string, options?: AskOptions) => Promise<string>;

export class ClaudeError extends Error {}

type CliResult = { is_error?: boolean; result?: string };

export const askClaude: AskClaude = (prompt, options = {}) =>
  new Promise((resolve, reject) => {
    const args = ["-p", "--output-format", "json", "--tools", options.allowRead ? "Read" : ""];
    if (options.allowRead) args.push("--allowedTools", "Read");
    const child = spawn("claude", args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new ClaudeError(`Claude 응답이 ${claudeTimeoutMs / 60_000}분 안에 오지 않았습니다.`));
    }, claudeTimeoutMs);
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(new ClaudeError(`claude 실행 실패: ${error.message}`));
    });
    child.on("close", () => {
      clearTimeout(timer);
      try {
        const parsed = JSON.parse(stdout) as CliResult;
        if (parsed.is_error || typeof parsed.result !== "string") throw new ClaudeError(parsed.result ?? "Claude 응답이 비었습니다.");
        resolve(parsed.result);
      } catch (error) {
        reject(error instanceof ClaudeError ? error : new ClaudeError(`Claude 응답을 읽지 못했습니다: ${(stderr || stdout).slice(0, 200)}`));
      }
    });
    child.stdin.end(prompt);
  });

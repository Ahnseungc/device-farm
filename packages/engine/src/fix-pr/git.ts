import { execFile } from "node:child_process";

/**
 * 수정 PR용 `git`. 토큰은 원격 주소·설정 파일·명령 인자에 넣지 않고 환경변수 설정(GIT_CONFIG_*)으로만 넘긴다
 * (specs/README.md 「토큰 다루기」).
 */

export type Git = (args: string[], cwd: string) => Promise<string>;

/** git이 토큰을 헤더로 쓰고, 이 맥의 다른 GitHub 로그인(키체인)은 쓰지 않게 하는 환경변수 */
export function gitAuthEnv(token: string): Record<string, string> {
  const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
  return {
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_COUNT: "2",
    GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basic}`,
    GIT_CONFIG_KEY_1: "credential.helper",
    GIT_CONFIG_VALUE_1: "",
  };
}

/** 오류 문구에서 토큰(원문·base64)을 가린다 */
export function maskToken(text: string, token: string): string {
  const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
  return text.split(token).join("***").split(basic).join("***");
}

export class GitError extends Error {}

/** 실제 git. `env`는 process.env 위에 얹는다(작성자 정보·토큰 헤더) */
export function createGit(token: string, author: { name: string; email: string }): Git {
  const env = {
    ...process.env,
    ...gitAuthEnv(token),
    GIT_AUTHOR_NAME: author.name,
    GIT_AUTHOR_EMAIL: author.email,
    GIT_COMMITTER_NAME: author.name,
    GIT_COMMITTER_EMAIL: author.email,
  };
  return (args, cwd) =>
    new Promise((resolve, reject) => {
      execFile("git", args, { cwd, env, maxBuffer: 16 * 1024 * 1024, timeout: 10 * 60_000 }, (error, stdout, stderr) => {
        if (error) reject(new GitError(maskToken(`git ${args[0]} 실패: ${(stderr || error.message).trim().slice(0, 400)}`, token)));
        else resolve(stdout);
      });
    });
}

/**
 * `npx device-farm farm-password` — 팀 비밀번호를 두 번 묻고(화면에 안 보임) `.env`의 `FARM_PASSWORD_HASH` 값을 출력한다.
 * 비밀번호는 인자로 받지 않는다(셸 기록에 남는다).
 */
import path from "node:path";
import { stdin, stdout, stderr } from "node:process";
import { fileURLToPath } from "node:url";

import { hashPassword, minPasswordLength } from "@device-farm/server/auth/password";

export const tooShortMessage = `비밀번호는 ${minPasswordLength}자 이상이어야 합니다.`;
export const mismatchMessage = "두 비밀번호가 다릅니다.";

/** 입력 검사. 문제가 없으면 null */
export function passwordProblem(first: string, second: string): string | null {
  if (first.length < minPasswordLength) return tooShortMessage;
  if (first !== second) return mismatchMessage;
  return null;
}

/** 터미널에서 글자를 보이지 않게 한 줄 읽는다 */
function askHidden(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!stdin.isTTY) {
      reject(new Error("터미널에서 직접 실행해 주세요(비밀번호를 파이프로 받지 않습니다)."));
      return;
    }
    stderr.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let value = "";
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", onData);
          stderr.write("\n");
          resolve(value);
          return;
        }
        if (char === "\u0003") {
          stdin.setRawMode(false);
          stderr.write("\n");
          process.exit(130);
        }
        if (char === "\u007f" || char === "\b") value = value.slice(0, -1);
        else value += char;
      }
    };
    stdin.on("data", onData);
  });
}

export async function farmPassword(): Promise<void> {
  const first = await askHidden("팀 비밀번호: ");
  const second = await askHidden("한 번 더: ");
  const problem = passwordProblem(first, second);
  if (problem) {
    stderr.write(`${problem}\n`);
    process.exitCode = 1;
    return;
  }
  const hash = await hashPassword(first);
  stderr.write(".env에 아래 한 줄을 넣고 서버를 다시 띄우세요. 기존 로그인은 모두 풀립니다.\n");
  stdout.write(`FARM_PASSWORD_HASH=${hash}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  farmPassword().catch((error: unknown) => {
    stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

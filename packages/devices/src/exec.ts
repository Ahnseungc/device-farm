import { execFile } from "node:child_process";

/** stdout을 돌려준다. 0이 아닌 종료는 stderr 첫 줄을 담아 reject. */
export type Exec = (command: string, args: readonly string[]) => Promise<string>;

export const execFileText: Exec = (command, args) =>
  new Promise((resolve, reject) => {
    execFile(command, [...args], { maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (!error) {
        resolve(stdout);
        return;
      }
      const firstLine = String(stderr).split("\n").find((line) => line.trim()) ?? error.message;
      reject(new Error(firstLine));
    });
  });

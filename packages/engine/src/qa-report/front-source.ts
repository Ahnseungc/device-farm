import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

import type { Git } from "../fix-pr/git";

/**
 * 제보를 플로우로 바꿀 때 Claude가 앱 코드(`FARM_FIX_PR_REPO`의 첫 base 브랜치)에서 정상 문구(토스트·안내)를 찾게 하는 읽기 전용 사본.
 * 수정 PR이 쓰는 레포 사본(`test-results/fix-pr/<repo>`)에 분리된 작업 트리 하나를 두고, 제보마다 최신으로 맞춘다.
 */
export async function refreshQaFront(git: Git, root: string, repo: string, base: string): Promise<string> {
  const repoDir = path.join(root, repo.split("/").pop() ?? "repo");
  const dir = path.join(root, "qa-front");
  if (!existsSync(path.join(repoDir, ".git"))) {
    mkdirSync(root, { recursive: true });
    await git(["clone", "--filter=blob:none", "--no-checkout", `https://github.com/${repo}.git`, repoDir], root);
  }
  await git(["fetch", "--prune", "origin", base], repoDir);
  if (existsSync(path.join(dir, ".git"))) await git(["checkout", "--detach", "--force", `origin/${base}`], dir);
  else await git(["worktree", "add", "--force", "--detach", dir, `origin/${base}`], repoDir);
  return dir;
}

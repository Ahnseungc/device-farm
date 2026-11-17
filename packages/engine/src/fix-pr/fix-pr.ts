import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

import { fixBranchName, fixCommitMessage, fixPrBody, fixPrompt, fixPrTitle, parseNoFix, type FixableAlert, type FixPrLink, type NoFixCategory } from "@device-farm/core/slack/fix-pr";

import { readRun } from "../results";
import { testResultsRoot } from "../run";
import { runClaudeFix, type ClaudeFix } from "./claude-fix";
import { createGit, type Git } from "./git";
import { createGithub, type Github, type GithubUser } from "./github";

/**
 * 슬랙 오류 알림 → Claude 수정 → 토큰 계정으로 앱 프론트 레포에 PR (specs/README.md).
 * 끄고 켜기: `.env` `FARM_FIX_PR_GITHUB_TOKEN`·`FARM_FIX_PR_REPO`가 둘 다 있어야 켜진다(기본 꺼짐).
 * git·GitHub·Claude는 주입받는다(테스트는 가짜).
 */

/** `FARM_FIX_PR_BASES`가 비면 이 브랜치 하나에만 PR을 연다 */
export const defaultFixPrBases = ["main"] as const;

export interface FixPrConfig {
  token: string;
  /** `owner/name` */
  repo: string;
  /** 첫 번째가 수정 기준, 나머지는 cherry-pick */
  bases: readonly string[];
}

/**
 * `.env`에서 읽는다. 토큰·레포가 없으면 null(버튼을 달지 않는다).
 * `FARM_FIX_PR_GITHUB_TOKEN`: PR을 열 GitHub 토큰 · `FARM_FIX_PR_REPO`: `owner/name` · `FARM_FIX_PR_BASES`: 쉼표로 나눈 base 브랜치(첫 번째가 기준)
 */
export function fixPrConfigFromEnv(env: NodeJS.ProcessEnv = process.env): FixPrConfig | null {
  const token = env.FARM_FIX_PR_GITHUB_TOKEN?.trim();
  const repo = env.FARM_FIX_PR_REPO?.trim();
  if (!token || !repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) return null;
  const bases = (env.FARM_FIX_PR_BASES ?? "").split(",").map((base) => base.trim()).filter(Boolean);
  return { token, repo, bases: bases.length > 0 ? bases : defaultFixPrBases };
}

export type FixPrResult =
  | { state: "opened"; prs: FixPrLink[]; summary: string; skipped: { base: string; reason: string }[] }
  | { state: "no-change"; summary: string; category: NoFixCategory };

export interface FixPrDeps {
  git: Git;
  github: Github;
  claude: ClaudeFix;
  repo: string;
  bases: readonly string[];
  /** 레포 사본·작업 트리를 두는 폴더 */
  root: string;
  now?: () => Date;
  exists?: (file: string) => boolean;
  mkdir?: (dir: string) => void;
  farmOrigin?: string;
  /** 프롬프트에 넣을 앱 이름(`AppConfig.name`) */
  appName?: string;
  /** 실패 스크린샷·로그(절대 경로) */
  evidence?: (alert: FixableAlert) => { resultsDir: string | null; screenshot?: string; logDir?: string };
  log?: (message: string) => void;
}

export async function runFixPr(alert: FixableAlert, deps: FixPrDeps): Promise<FixPrResult> {
  const { git, github, repo, bases } = deps;
  const exists = deps.exists ?? existsSync;
  const mkdir = deps.mkdir ?? ((dir: string) => mkdirSync(dir, { recursive: true }));
  const [first, ...rest] = bases;
  if (!first) throw new Error("base 브랜치가 없어요.");
  const repoDir = path.join(deps.root, repo.split("/").pop() ?? "repo");
  const workRoot = path.join(deps.root, "work");

  if (!exists(path.join(repoDir, ".git"))) {
    mkdir(deps.root);
    await git(["clone", "--filter=blob:none", "--no-checkout", `https://github.com/${repo}.git`, repoDir], deps.root);
  }
  await git(["fetch", "--prune", "origin", ...bases], repoDir);
  mkdir(workRoot);

  const branch = fixBranchName(alert.key, deps.now?.() ?? new Date());
  const worktrees: { dir: string; branch: string }[] = [];
  const addWorktree = async (name: string, base: string) => {
    const dir = path.join(workRoot, name.replace(/\//g, "_"));
    await git(["worktree", "add", "--force", "-B", name, dir, `origin/${base}`], repoDir);
    worktrees.push({ dir, branch: name });
    return dir;
  };

  try {
    const dir = await addWorktree(branch, first);
    const evidence = deps.evidence?.(alert) ?? { resultsDir: null };
    const summary = (
      await deps.claude({ cwd: dir, prompt: fixPrompt(alert, { repo, base: first, appName: deps.appName, ...evidence }), addDirs: evidence.resultsDir ? [evidence.resultsDir] : [] })
    ).trim();
    const changed = (await git(["status", "--porcelain"], dir)).trim();
    const noFix = parseNoFix(summary);
    if (noFix) return { state: "no-change", summary: noFix.reason, category: noFix.category };
    if (!changed) return { state: "no-change", summary, category: "unsure" };

    await git(["add", "-A"], dir);
    await git(["commit", "-m", fixCommitMessage(alert)], dir);
    const sha = (await git(["rev-parse", "HEAD"], dir)).trim();
    await git(["push", "origin", `HEAD:refs/heads/${branch}`], dir);
    const prs: FixPrLink[] = [];
    const opened = await github.createPull(repo, { head: branch, base: first, title: fixPrTitle(alert, first, first), body: fixPrBody(alert, { summary, farmOrigin: deps.farmOrigin }) });
    prs.push({ base: first, ...opened });
    deps.log?.(`수정 PR: ${first} #${opened.number}`);

    const skipped: { base: string; reason: string }[] = [];
    for (const base of rest) {
      const name = `${branch}-${base}`;
      const baseDir = await addWorktree(name, base);
      try {
        await git(["cherry-pick", sha], baseDir);
      } catch {
        await git(["cherry-pick", "--abort"], baseDir).catch(() => "");
        skipped.push({ base, reason: `${base}에 그대로 얹히지 않아요(충돌)` });
        continue;
      }
      await git(["push", "origin", `HEAD:refs/heads/${name}`], baseDir);
      const pull = await github.createPull(repo, { head: name, base, title: fixPrTitle(alert, base, first), body: fixPrBody(alert, { summary, farmOrigin: deps.farmOrigin, related: prs }) });
      prs.push({ base, ...pull });
      deps.log?.(`수정 PR: ${base} #${pull.number}`);
    }
    return { state: "opened", prs, summary, skipped };
  } finally {
    // 작업 트리·로컬 브랜치는 실패해도 지운다(원격 브랜치는 PR이 쓴다)
    for (const worktree of worktrees.reverse()) {
      await git(["worktree", "remove", "--force", worktree.dir], repoDir).catch(() => "");
      await git(["branch", "-D", worktree.branch], repoDir).catch(() => "");
    }
    await git(["worktree", "prune"], repoDir).catch(() => "");
  }
}

/** 점검 결과에서 실패 화면의 스크린샷·로그 폴더를 찾는다 */
export function evidenceOf(alert: FixableAlert, root = testResultsRoot): { resultsDir: string | null; screenshot?: string; logDir?: string } {
  const resultsDir = path.join(root, "devices", alert.runId);
  const run = readRun(alert.runId);
  const screen = alert.type === "failure" ? run?.outcomes.flatMap((outcome) => outcome.screens).find((one) => one.scenario === alert.path && one.status === "failed") : undefined;
  return {
    resultsDir: existsSync(resultsDir) ? resultsDir : null,
    ...(screen?.screenshot ? { screenshot: path.join(root, screen.screenshot) } : {}),
    ...(screen?.logDir ? { logDir: path.join(root, screen.logDir) } : {}),
  };
}

export type FixPrRunner = (alert: FixableAlert) => Promise<FixPrResult>;

/** 실제 git·GitHub·Claude로 묶는다. 커밋 작성자는 토큰의 GitHub 사용자(처음 한 번 확인) */
export function createFixPrRunner(config: FixPrConfig, log: (message: string) => void, appName?: string): FixPrRunner {
  const github = createGithub(config.token);
  let user: Promise<GithubUser> | null = null;
  return async (alert) => {
    user ??= github.user().catch((error: unknown) => {
      user = null;
      throw error;
    });
    const { login, id } = await user;
    const git = createGit(config.token, { name: login, email: `${id}+${login}@users.noreply.github.com` });
    return runFixPr(alert, {
      git,
      github,
      claude: runClaudeFix,
      repo: config.repo,
      bases: config.bases,
      root: path.join(testResultsRoot, "fix-pr"),
      farmOrigin: process.env.FARM_PUBLIC_ORIGIN?.trim() || undefined,
      appName,
      evidence: (one) => evidenceOf(one),
      log,
    });
  };
}

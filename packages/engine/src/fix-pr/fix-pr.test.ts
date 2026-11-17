import assert from "node:assert/strict";

import type { FailureAlert } from "@device-farm/core/slack/failure-alert";

import { claudeFixArgs } from "./claude-fix";
import { runFixPr, type FixPrDeps } from "./fix-pr";
import { gitAuthEnv, maskToken } from "./git";

const alert: FailureAlert = {
  type: "failure",
  key: "failure|dev|앱 · 홈|흰 화면",
  path: "앱 · 홈",
  finding: "app-error",
  message: "흰 화면",
  device: "iPhone 13 (ios 18)",
  build: "dev 2.0.28",
  runId: "r1",
};

type Call = { args: string[]; cwd: string };

function setup(options: { changed?: string; answer?: string; cherryFails?: boolean; cloned?: boolean } = {}) {
  const calls: Call[] = [];
  const pulls: { head: string; base: string; title: string; body: string }[] = [];
  const deps: FixPrDeps = {
    repo: "example/shop-web",
    bases: ["development", "main"],
    root: "/data/fix-pr",
    now: () => new Date(2026, 10, 17, 9, 5),
    exists: () => options.cloned ?? true,
    mkdir: () => undefined,
    farmOrigin: "https://farm",
    git: async (args, cwd) => {
      calls.push({ args, cwd });
      if (args[0] === "status") return options.changed ?? " M src/home.tsx\n";
      if (args[0] === "rev-parse") return "abc123\n";
      if (args[0] === "cherry-pick" && args[1] !== "--abort" && options.cherryFails) throw new Error("conflict");
      return "";
    },
    github: {
      user: async () => ({ login: "fix-bot", id: 1 }),
      createPull: async (_repo, pull) => {
        pulls.push(pull);
        return { number: 10 + pulls.length, url: `https://github.com/x/pull/${10 + pulls.length}` };
      },
    },
    claude: async ({ cwd }) => {
      calls.push({ args: ["<claude>"], cwd });
      return options.answer ?? "원인: 홈 API 실패 처리 누락\n고침: src/home.tsx";
    },
  };
  return { deps, calls, pulls };
}

const cmd = (call: Call) => call.args.join(" ");

// 고침 → development PR → main cherry-pick PR
{
  const { deps, calls, pulls } = setup();
  const result = await runFixPr(alert, deps);
  assert.equal(result.state, "opened");
  assert.ok(result.state === "opened");
  assert.deepEqual(
    result.prs.map((pr) => `${pr.base} #${pr.number}`),
    ["development #11", "main #12"],
  );
  assert.deepEqual(result.skipped, []);
  const branch = pulls[0].head;
  assert.match(branch, /^farm-fix\/20261117-0905-[0-9a-f]{8}$/);
  assert.equal(pulls[0].base, "development");
  assert.equal(pulls[1].head, `${branch}-main`);
  assert.equal(pulls[1].base, "main");
  assert.ok(pulls[1].title.startsWith("[hotfix] "));
  assert.ok(pulls[1].body.includes("https://github.com/x/pull/11"));
  const order = calls.map(cmd);
  assert.equal(order[0], "fetch --prune origin development main");
  assert.ok(order[1].startsWith(`worktree add --force -B ${branch} `) && order[1].endsWith(" origin/development"));
  assert.equal(order[2], "<claude>");
  assert.deepEqual(order.slice(3, 8), ["status --porcelain", "add -A", "commit -m fix: 앱 오류 · 앱 · 홈", "rev-parse HEAD", `push origin HEAD:refs/heads/${branch}`]);
  assert.ok(order.includes("cherry-pick abc123"));
  assert.ok(order.includes(`push origin HEAD:refs/heads/${branch}-main`));
  // 작업 트리·로컬 브랜치는 지운다
  assert.ok(order.includes(`branch -D ${branch}`));
  assert.ok(order.includes(`branch -D ${branch}-main`));
  assert.equal(order.at(-1), "worktree prune");
  // Claude는 작업 트리에서 돈다
  assert.equal(calls[2].cwd, calls.find((call) => call.args[0] === "status")?.cwd);
}

// 처음이면 받는다
{
  const { deps, calls } = setup({ cloned: false });
  await runFixPr(alert, deps);
  assert.equal(cmd(calls[0]), "clone --filter=blob:none --no-checkout https://github.com/example/shop-web.git /data/fix-pr/shop-web");
}

// 바뀐 게 없거나 NO_FIX면 PR 없음, 작업 트리는 지운다
for (const options of [{ changed: "" }, { answer: "NO_FIX: 서버 500이라 프론트 문제가 아니에요" }, { answer: "NO_FIX — 서버 500이라 프론트 문제가 아니에요" }]) {
  const { deps, calls, pulls } = setup(options);
  const result = await runFixPr(alert, deps);
  assert.equal(result.state, "no-change");
  assert.equal(pulls.length, 0);
  assert.ok(!calls.some((call) => call.args[0] === "push"));
  assert.ok(calls.some((call) => cmd(call).startsWith("worktree remove --force")));
  if (options.answer) assert.equal(result.summary, "서버 500이라 프론트 문제가 아니에요");
  assert.ok(result.state === "no-change" && result.category === "unsure");
}

// main에 얹히지 않으면 main만 건너뛴다
{
  const { deps, calls, pulls } = setup({ cherryFails: true });
  const result = await runFixPr(alert, deps);
  assert.ok(result.state === "opened");
  assert.equal(result.prs.length, 1);
  assert.deepEqual(result.skipped, [{ base: "main", reason: "main에 그대로 얹히지 않아요(충돌)" }]);
  assert.equal(pulls.length, 1);
  assert.ok(calls.some((call) => cmd(call) === "cherry-pick --abort"));
}

// 중간에 실패해도 작업 트리는 지운다
{
  const { deps, calls } = setup();
  deps.github.createPull = async () => {
    throw new Error("GitHub 422");
  };
  await assert.rejects(runFixPr(alert, deps), /GitHub 422/);
  assert.ok(calls.some((call) => cmd(call).startsWith("worktree remove --force")));
}

// 토큰은 헤더 환경변수로만, 다른 로그인은 끈다
{
  const env = gitAuthEnv("github_pat_SECRET");
  assert.equal(env.GIT_CONFIG_KEY_0, "http.https://github.com/.extraheader");
  assert.ok(!Object.values(env).some((value) => value.includes("github_pat_SECRET")));
  assert.equal(env.GIT_CONFIG_KEY_1, "credential.helper");
  assert.equal(env.GIT_CONFIG_VALUE_1, "");
  const basic = Buffer.from("x-access-token:github_pat_SECRET").toString("base64");
  assert.equal(maskToken(`fatal github_pat_SECRET ${basic}`, "github_pat_SECRET"), "fatal *** ***");
}

// Claude는 Bash 없이
assert.ok(!claudeFixArgs(["/r"]).join(" ").includes("Bash"));
assert.deepEqual(claudeFixArgs(["/r"]).slice(-2), ["--add-dir", "/r"]);

// 디바이스팜 오탐 분류는 그대로 넘긴다
{
  const { deps } = setup({ answer: "NO_FIX farm\n점검기가 줄임표를 겹침으로 봤어요" });
  assert.deepEqual(await runFixPr(alert, deps), { state: "no-change", summary: "점검기가 줄임표를 겹침으로 봤어요", category: "farm" });
}

console.log("fix-pr runner ok");

// 토큰·레포가 둘 다 있어야 켜진다. base는 쉼표로, 없으면 main
{
  const { fixPrConfigFromEnv } = await import("./fix-pr");
  assert.equal(fixPrConfigFromEnv({}), null);
  assert.equal(fixPrConfigFromEnv({ FARM_FIX_PR_GITHUB_TOKEN: "t" }), null);
  assert.equal(fixPrConfigFromEnv({ FARM_FIX_PR_GITHUB_TOKEN: "t", FARM_FIX_PR_REPO: "not a repo" }), null);
  assert.deepEqual(fixPrConfigFromEnv({ FARM_FIX_PR_GITHUB_TOKEN: "t", FARM_FIX_PR_REPO: "example/shop-web" }), { token: "t", repo: "example/shop-web", bases: ["main"] });
  assert.deepEqual(fixPrConfigFromEnv({ FARM_FIX_PR_GITHUB_TOKEN: "t", FARM_FIX_PR_REPO: "example/shop-web", FARM_FIX_PR_BASES: "development, main" })?.bases, ["development", "main"]);
  console.log("fix-pr config ok");
}

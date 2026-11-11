import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { ScreenDriver } from "@device-farm/core/device/driver";
import { parseModelJson } from "@device-farm/core/flows/prompt";
import { runFlow } from "@device-farm/core/flows/run";
import { isPrdName, stepTarget, validateGenerated, type FlowDocument } from "@device-farm/core/flows/schema";

import { generateFromPrd, sameHashReason } from "./generate";
import { addCandidate, confirmFlows, listPrds, readCandidates, readReady, type FlowDirs } from "./store";
import { sampleApp } from "@device-farm/core/config/sample-app";

const prd = "혜택 화면에서 출석체크 버튼을 누르면 출석 화면이 열린다.";
const good = {
  id: "attendance",
  name: "출석체크 열기",
  requirement: "출석체크 버튼을 누르면 출석 화면이 열린다",
  proposal: "create",
  steps: [
    { type: "click", target: { role: "link", name: "혜택" } },
    { type: "click", target: { role: "button", name: "출석체크" } },
    { type: "expectText", text: "출석" },
  ],
};
const validate = (raw: unknown) => validateGenerated(raw, 0, new Set(), "a.md", prd, sampleApp.guard.forbiddenClickNames);

// 검증: 정상 / 금지 버튼 / 주소로 열기(navigate) 금지 / 누르는 스텝 없음 / PRD에 없는 요구 문장
assert.equal(validate(good).status, "generated");
assert.equal(validate({ ...good, steps: [good.steps[0], { type: "click", target: { role: "button", name: "판매하기" } }, good.steps[2]] }).status, "generation_failed");
assert.match(validate({ ...good, steps: [{ type: "navigate", path: "/benefit" }, ...good.steps] }).reason ?? "", /navigate는 쓸 수 없습니다/);
assert.equal(validate({ ...good, steps: [good.steps[2]] }).reason, "누르는 스텝이 없습니다.");
assert.equal(validate({ ...good, requirement: "없는 문장" }).reason, "요구 문장이 PRD에 없습니다.");

// PRD 이름: App Router 경로는 허용, 상위 탈출은 거부
assert.equal(isPrdName("app/(protected)/benefit/_src/specs/README.md"), true);
assert.equal(isPrdName("app/../../etc/passwd.md"), false);
assert.deepEqual(parseModelJson("```json\n[1]\n```"), [1]);

// 홈으로 못 가면 첫 스텝(홈에서 시작)에서 실패한다
{
  const driver = { app: sampleApp, goHome: async () => undefined } as unknown as ScreenDriver;
  const result = await runFlow(driver, validate(good), { waitForScreen: async () => ({ ok: false, message: "이동 실패" }) });
  assert.match(result.message ?? "", /^1단계 홈에서 시작 「홈」 실패: 이동 실패/);
}

// 실행: 홈에서 시작해 순서대로, 링크·버튼 역할을 넘기고, 실패한 스텝에서 멈추고 몇 단계가 왜 실패했는지 남긴다
{
  const calls: string[] = [];
  const driver = {
    app: sampleApp,
    goHome: async () => void calls.push("home"),
    currentPath: async () => "/benefit",
    clickButton: async (name: string, role: string) => void calls.push(`${role} ${name}`),
    expectText: async (text: string) => {
      calls.push(`expect ${text}`);
      throw new Error(`"${text}" 문구가 나오지 않았습니다.`);
    },
  } as unknown as ScreenDriver;
  const flow = validate(good) as FlowDocument;
  const started: number[] = [];
  const result = await runFlow(driver, { ...flow, steps: [...flow.steps, good.steps[1] as FlowDocument["steps"][number]] }, {
    now: () => 0,
    waitForScreen: async () => ({ ok: true }),
    onStep: (index) => started.push(index),
  });
  assert.deepEqual(started, [0, 1, 2, 3]);
  assert.deepEqual(calls, ["home", "link 혜택", "button 출석체크", "expect 출석"]);
  assert.equal(result.status, "failed");
  assert.deepEqual(result.steps.map((step) => step.status), ["passed", "passed", "passed", "failed"]);
  assert.match(result.message ?? "", /^4단계 문구 확인 「출석」 실패/);
}

// 접두어 일치: 이름에 데이터가 들어가는 버튼(「Lv. 2 …」)은 prefix로 찾는다. 다른 match 값은 거절한다
{
  const level = { type: "click", target: { role: "button", name: "Lv.", match: "prefix" } };
  const checked = validate({ ...good, steps: [good.steps[0], level, good.steps[2]] });
  assert.equal(checked.status, "generated");
  assert.deepEqual(checked.steps[1], level);
  assert.equal(stepTarget(checked.steps[1]), "Lv.…");
  assert.equal(validate({ ...good, steps: [good.steps[0], { ...level, target: { ...level.target, match: "regex" } }, good.steps[2]] }).reason, "match는 prefix만 쓸 수 있습니다.");

  const matches: (string | undefined)[] = [];
  const driver = {
    app: sampleApp,
    goHome: async () => undefined,
    currentPath: async () => "/benefit",
    clickButton: async (_name: string, _role: string, match?: string) => void matches.push(match),
    expectText: async () => undefined,
  } as unknown as ScreenDriver;
  await runFlow(driver, checked, { now: () => 0, waitForScreen: async () => ({ ok: true }) });
  assert.deepEqual(matches, [undefined, "prefix"]);
}

// 저장소: PRD 목록, 생성 → 후보 → 확정, 같은 PRD는 다시 만들지 않는다
const root = mkdtempSync(path.join(tmpdir(), "flows-"));
try {
  const specDir = path.join(root, "front/app/(protected)/benefit/_src/specs");
  mkdirSync(specDir, { recursive: true });
  writeFileSync(path.join(specDir, "README.md"), prd);
  writeFileSync(path.join(root, "front/app/(protected)/benefit/page.md"), "스펙 폴더 밖");
  process.env.FLOW_PRD_ROOT = path.join(root, "front");
  const name = "app/(protected)/benefit/_src/specs/README.md";
  assert.deepEqual(listPrds(), [name]);

  const dirs: FlowDirs = { ready: path.join(root, "ready"), generated: path.join(root, "generated") };
  const llm = async () => ({ ok: true as const, text: JSON.stringify([{ ...good, steps: [{ type: "click", target: { role: "link", name: "혜택" } }, { type: "expectText", text: "혜택" }] }]) });
  const first = await generateFromPrd(sampleApp, name, dirs, llm);
  assert.deepEqual(first, { ok: true, generated: 1, skipped: false });
  assert.deepEqual(await generateFromPrd(sampleApp, name, dirs, llm), { ok: true, generated: 0, skipped: true, reason: sameHashReason });
  assert.equal(readCandidates(dirs).length, 1);

  assert.equal(confirmFlows(undefined, dirs), 1);
  assert.equal(readCandidates(dirs).length, 0);
  assert.deepEqual(readReady(dirs).map((item) => [item.id, item.status]), [["attendance", "ready"]]);
  const saved = JSON.parse(readFileSync(path.join(dirs.ready, "attendance.json"), "utf8")) as FlowDocument;
  assert.equal(saved.proposal, undefined);
  assert.equal(existsSync(path.join(dirs.generated, "hashes.json")), true);

  // 화면 지도 조립 후보: 같은 id는 바꾸고, 확정하면 map_built 그대로 읽힌다
  const mapFlow: FlowDocument = { id: "map-1", name: "지도", source: "map_built", status: "generated", prd: "화면 지도", requirement: "", proposal: "create", steps: good.steps as FlowDocument["steps"] };
  addCandidate(mapFlow, dirs);
  addCandidate({ ...mapFlow, name: "지도 2" }, dirs);
  assert.deepEqual(readCandidates(dirs).map((item) => item.name), ["지도 2"]);
  assert.equal(confirmFlows(["map-1"], dirs), 1);
  assert.equal(readReady(dirs).find((item) => item.id === "map-1")?.source, "map_built");
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log("flows ok");

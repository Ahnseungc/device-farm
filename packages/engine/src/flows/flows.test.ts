import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { ScreenDriver } from "@device-farm/core/device/driver";
import { parseModelJson } from "@device-farm/core/flows/prompt";
import { isInfraFailure } from "@device-farm/core/device/infra-error";
import { runFlow } from "@device-farm/core/flows/run";
import { isPrdName, stepTarget, stepsOf, validateGenerated, type FlowDocument } from "@device-farm/core/flows/schema";

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

// 처음 한 번 뜨는 안내(혜택 튜토리얼): 탭을 누른 뒤 안내 화면이면 넘기고 플로우를 이어 간다.
// 안내 버튼을 직접 누르는 플로우(안내 화면 점검)는 넘기지 않는다
{
  const checked = validate(good);
  let path = "/home";
  const clicked: string[] = [];
  const driver = {
    app: sampleApp,
    goHome: async () => undefined,
    currentPath: async () => path,
    clickButton: async (name: string) => {
      clicked.push(name);
      if (name === "혜택") path = "/benefit/onboarding";
      if (name === "시작하기") path = "/benefit";
    },
    expectText: async () => undefined,
  } as unknown as ScreenDriver;
  assert.equal((await runFlow(driver, checked, { now: () => 0, waitForScreen: async () => ({ ok: true }) })).status, "passed");
  assert.deepEqual(clicked, ["혜택", "시작하기", "출석체크"]);

  const intro = validate({ ...good, steps: [good.steps[0], { type: "click", target: { role: "button", name: "시작하기" } }, good.steps[2]] });
  path = "/home";
  clicked.length = 0;
  await runFlow(driver, intro, { now: () => 0, waitForScreen: async () => ({ ok: true }) });
  assert.deepEqual(clicked, ["혜택", "시작하기"]);
}

// 디자인 확인 스텝: 형식 검사, 그 자리에서 대조기를 부르고(스텝 번호와 함께) 플로우는 이어 간다. 대조기가 없으면 그냥 통과
{
  const checked = validate({ ...good, steps: [good.steps[0], { type: "design" }, good.steps[2]] });
  assert.equal(checked.status, "generated");
  assert.equal(stepTarget(checked.steps[1]), "지금 화면");
  const driver = { app: sampleApp, goHome: async () => undefined, currentPath: async () => "/benefit", clickButton: async () => undefined, expectText: async () => undefined } as unknown as ScreenDriver;
  const designed: number[] = [];
  const result = await runFlow(driver, checked, { now: () => 0, waitForScreen: async () => ({ ok: true }), checkDesign: async (_driver, index) => void designed.push(index) });
  assert.equal(result.status, "passed");
  assert.deepEqual(designed, [2]);
  assert.equal((await runFlow(driver, checked, { now: () => 0, waitForScreen: async () => ({ ok: true }) })).status, "passed");
}

// 입력 스텝: 형식 검사, 입력칸이 늦게 그려져도 다시 찾아 넣는다, 끝내 없으면 실패
{
  const fill = { type: "fill", label: "중량", value: "3.75" };
  const checked = validate({ ...good, steps: [good.steps[0], fill, good.steps[2]] });
  assert.equal(checked.status, "generated");
  assert.deepEqual(checked.steps[1], fill);
  assert.equal(stepTarget(checked.steps[1]), "중량: 3.75");
  assert.equal(validate({ ...good, steps: [good.steps[0], { type: "fill", label: "", value: "1" }, good.steps[2]] }).reason, "입력칸 이름이 비어 있습니다.");

  const scripts: string[] = [];
  let tries = 0;
  const driver = {
    app: sampleApp,
    goHome: async () => undefined,
    currentPath: async () => "/benefit",
    clickButton: async () => undefined,
    expectText: async () => undefined,
    evaluate: async (script: string) => {
      scripts.push(script);
      tries += 1;
      return tries > 1;
    },
  } as unknown as ScreenDriver;
  const passed = await runFlow(driver, checked, { now: () => 0, waitForScreen: async () => ({ ok: true }) });
  assert.equal(passed.status, "passed");
  assert.ok(scripts[0].includes('"중량"') && scripts[0].includes('"3.75"'));

  const missing = { ...driver, evaluate: async () => false } as unknown as ScreenDriver;
  const failed = await runFlow(missing, checked, { now: () => 0, waitMs: 0, waitForScreen: async () => ({ ok: true }) });
  assert.match(failed.message ?? "", /3단계 입력 「중량: 3.75」 실패: 「중량」 입력칸을 찾지 못했습니다/);
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

// 누르기 기록: 누르기 전후 화면과 누른 자리를 남기고, 멈추면 멈춘 자리를 남긴다. 화면 글자 내용은 남기지 않는다
{
  const lines: string[] = [];
  const traced: ScreenDriver = {
    app: sampleApp,
    navigate: async () => {},
    clickButton: async () => {},
    expectText: async () => { throw new Error("\"포인트\" 문구가 10000ms 안에 나오지 않았습니다."); },
    currentPath: async () => "/my",
    hasText: async () => false,
    screenshot: async () => Buffer.alloc(0),
    evaluate: async <T>() => ({ text: 812, dialogs: 0 }) as T,
    close: async () => {},
    goHome: async () => {},
    tapTrace: async () => "누른 자리 540,1234 · 웹 화면 */my",
    screenMismatch: async () => "화면에 보이는 글자 10개 중 읽는 웹 화면(/my)에 없는 것 7개",
  };
  const result = await runFlow(
    traced,
    { id: "t", name: "t", source: "recorded", status: "ready", prd: "a.md", requirement: "r", steps: [{ type: "click", target: { role: "button", name: "충전하기" } }, { type: "expectText", text: "포인트" }] },
    { waitForScreen: async () => ({ ok: true }), onTrace: (line) => void lines.push(line) },
  );
  assert.equal(result.status, "failed");
  assert.equal(result.message, "3단계 문구 확인 「포인트」 실패: \"포인트\" 문구가 10000ms 안에 나오지 않았습니다.");
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^2단계 누르기 「충전하기」: \/my\(글자 812·팝업 0\) → .* · 화면 그대로 · 누른 자리 540,1234/);
  assert.match(lines[1], /^3단계 문구 확인 「포인트」 실패한 자리: .*없는 것 7개$/);
}

// 버튼을 못 찾아 멈추면 그 화면에서 누를 수 있던 이름을 남긴다. 다른 실패에는 남기지 않는다
for (const [why, expected] of [['"설정" 버튼를 찾지 못했습니다.', ["button 계정 설정", "link 카테고리"]], ['"설정" 버튼이 다른 요소(div)에 가려져 있습니다. 누르지 않았습니다.', undefined]] as const) {
  const stuck: ScreenDriver = {
    app: sampleApp,
    navigate: async () => {},
    clickButton: async () => { throw new Error(why); },
    expectText: async () => {},
    currentPath: async () => "/menu",
    hasText: async () => false,
    screenshot: async () => Buffer.alloc(0),
    evaluate: async <T>() => [{ role: "button", name: "계정 설정" }, { role: "button", name: "계정 설정" }, { role: "link", name: "카테고리" }, { role: "input", name: "검색" }] as T,
    close: async () => {},
    goHome: async () => {},
  };
  const result = await runFlow(
    stuck,
    { id: "m", name: "m", source: "recorded", status: "ready", prd: "a.md", requirement: "r", steps: [{ type: "click", target: { role: "button", name: "설정" } }] },
    { waitForScreen: async () => ({ ok: true }) },
  );
  assert.deepEqual(result.steps.at(-1)?.seen, expected);
}

console.log("flows ok");

// 디자인 QA만 실행: 「디자인 확인」 스텝이 든 플로우만 고른다
{
  const { designFlowIds } = await import("@device-farm/core/flows/schema");
  const flows = [
    { id: "plain", steps: [{ type: "click", target: { role: "link", name: "혜택" } }] },
    { id: "design", steps: [{ type: "click", target: { role: "link", name: "혜택" } }, { type: "design" }] },
  ] as unknown as FlowDocument[];
  assert.deepEqual(designFlowIds(flows), ["design"]);
  assert.deepEqual(designFlowIds([]), []);
}

/** 잔액 글자·꺼진 버튼 안내를 앱 설정으로 준 앱 */
const adsApp = { ...sampleApp, ads: { balancePattern: "^(\\d+\\.\\d+)g$", disabledText: "부터 담기 가능" } };

// 광고 보고 적립: 잔액을 읽고 누르고 광고를 본 뒤 잔액이 늘면 통과, 안 늘면 얼마 그대로인지 남기고 실패. 기대 문구 없이도 된다
{
  const steps = stepsOf([{ type: "click", target: { role: "link", name: "혜택" } }, { type: "watchAd", target: { role: "button", name: "0.0000", match: "prefix" } }], sampleApp.guard.forbiddenClickNames);
  assert.ok(Array.isArray(steps), "watchAd만 있어도 플로우가 된다");
  const flow = { ...(validate(good) as FlowDocument), steps: steps as FlowDocument["steps"] };
  const run = async (balances: (number | null)[], ad: { shown: boolean }) => {
    const calls: string[] = [];
    let read = 0;
    const driver = {
      app: adsApp,
      goHome: async () => undefined,
      currentPath: async () => "/benefit",
      clickButton: async (name: string, _role: string, match?: string) => void calls.push(`${name}${match === "prefix" ? "…" : ""}`),
      evaluate: async (script: string) => {
        if (script === "location.reload()") return void calls.push("reload");
        return balances[Math.min(read++, balances.length - 1)];
      },
      watchAd: async () => (calls.push("ad"), ad.shown ? { shown: true, seconds: 31, closedBy: "「Close」를 눌러 닫음" } : { shown: false }),
    } as unknown as ScreenDriver;
    return { result: await runFlow(driver, flow, { now: () => 0, waitForScreen: async () => ({ ok: true }), adRewardWaitMs: 1_500 }), calls };
  };
  const ok = await run([0.105068, 0.105068, 0.10511], { shown: true });
  assert.equal(ok.result.status, "passed");
  assert.deepEqual(ok.calls, ["혜택", "0.0000…", "ad"]);

  const flat = await run([0.105068], { shown: true });
  assert.equal(flat.result.status, "failed");
  assert.match(flat.result.message ?? "", /^3단계 광고 보고 적립 「0\.0000…」 실패: 광고\(31초\)를 보고 「Close」를 눌러 닫음 1\.5초를 기다리고 화면을 다시 불러도 잔액이 늘지 않았습니다\(0\.105068 그대로\)/);
  assert.deepEqual(flat.calls, ["혜택", "0.0000…", "ad", "reload"], "그대로면 화면을 한 번 다시 불러 읽는다");

  // 늦게 바뀌는 헤더: 기다리는 동안은 그대로였다가 다시 불러오면 늘어 있으면 통과
  const late = await run([0.105068, 0.105068, 0.105068, 0.105068, 0.105068, 0.105168], { shown: true });
  assert.equal(late.result.status, "passed");
  assert.ok(late.calls.includes("reload"));

  const noBalance = await run([null], { shown: true });
  assert.match(noBalance.result.message ?? "", /잔액을 화면 위쪽에서 찾지 못했습니다/);
  assert.deepEqual(noBalance.calls, ["혜택"], "잔액을 못 읽으면 광고를 누르지 않는다");

  // 헤더 잔액이 늦게 뜨면 잠깐 다시 읽는다
  const lateBalance = await run([null, 0.105068, 0.105068, 0.10511], { shown: true });
  assert.equal(lateBalance.result.status, "passed");

  // 최소 적립량 미만이라 버튼이 툴팁에 가려지면 앱이 맞다: 「계정 상태 때문에 점검할 수 없습니다」(점검 못 함으로 분류)
  const blocked = {
    app: adsApp,
    goHome: async () => undefined,
    currentPath: async () => "/benefit",
    clickButton: async (name: string) => {
      if (name !== "혜택") throw new Error(`"${name}" 버튼이 다른 요소(div.relative.w-full)에 가려져 있습니다. 누르지 않았습니다.`);
    },
    hasText: async (text: string) => text === adsApp.ads.disabledText,
    evaluate: async () => 0.105068,
    watchAd: async () => ({ shown: false }),
  } as unknown as ScreenDriver;
  const tooLittle = await runFlow(blocked, flow, { now: () => 0, waitForScreen: async () => ({ ok: true }), adRewardWaitMs: 1_500 });
  assert.match(tooLittle.message ?? "", /계정 상태 때문에 점검할 수 없습니다: 최소 적립량에 못 미쳐/);
  assert.ok(isInfraFailure(tooLittle.message));
}

// fast: 시간 제한 화면(OX퀴즈 5초)에서는 화면 대기·누른 뒤 2초 없이 바로 누른다
{
  const steps = stepsOf([{ type: "click", target: { role: "button", name: "OX퀴즈" }, fast: true }, { type: "watchAd", target: { role: "button", name: "광고 보고 정답 확인하기" }, reward: "screen", fast: true }, { type: "expectText", text: "정답" }], sampleApp.guard.forbiddenClickNames);
  assert.ok(Array.isArray(steps));
  assert.deepEqual(steps[0], { type: "click", target: { role: "button", name: "OX퀴즈" }, fast: true });
  assert.equal((steps[1] as { fast?: boolean }).fast, true);
  const flow = { ...(validate(good) as FlowDocument), steps: steps as FlowDocument["steps"] };
  let waits = 0;
  const started = Date.now();
  const driver = {
      app: adsApp,
    goHome: async () => undefined,
    currentPath: async () => "/benefit",
    clickButton: async () => undefined,
    evaluate: async () => null,
    expectText: async () => undefined,
    watchAd: async () => ({ shown: false }),
  } as unknown as ScreenDriver;
  const result = await runFlow(driver, flow, { now: () => 0, waitForScreen: async () => ((waits += 1), { ok: true }) });
  assert.equal(result.status, "passed");
  assert.equal(waits, 1, "홈 시작 대기만 있고 fast 스텝 앞 화면 대기는 없다");
  assert.ok(Date.now() - started < 3_500, "fast 누르기 뒤 2초를 기다리지 않는다(광고 뒤 2초만)");
}

// 잔액이 아닌 보상(reward screen): 광고만 보고 닫고, 확인은 뒤 문구 스텝. 기대 문구가 꼭 있어야 하고, 광고가 안 떠도(dev 출석체크) 문구 스텝이 판정한다
{
  assert.equal(stepsOf([{ type: "watchAd", target: { role: "button", name: "광고 보고 정답 확인하기" }, reward: "screen" }], sampleApp.guard.forbiddenClickNames), "기대 문구가 없습니다.");
  assert.equal(stepsOf([{ type: "watchAd", target: { role: "button", name: "광고" }, reward: "ticket" }], sampleApp.guard.forbiddenClickNames), "광고 보상(reward)은 balance 또는 screen만 쓸 수 있습니다.");
  const steps = stepsOf([{ type: "watchAd", target: { role: "button", name: "광고 보고 정답 확인하기" }, reward: "screen" }, { type: "expectText", text: "정답" }], sampleApp.guard.forbiddenClickNames);
  assert.ok(Array.isArray(steps));
  const flow = { ...(validate(good) as FlowDocument), steps: steps as FlowDocument["steps"] };
  const driver = (shown: boolean) =>
    ({
      app: adsApp,
      goHome: async () => undefined,
      currentPath: async () => "/benefit",
      clickButton: async () => undefined,
      evaluate: async () => null,
      expectText: async () => undefined,
      watchAd: async () => (shown ? { shown: true, seconds: 30, closedBy: "「Close」를 눌러 닫음" } : { shown: false }),
    }) as unknown as ScreenDriver;
  assert.equal((await runFlow(driver(true), flow, { now: () => 0, waitForScreen: async () => ({ ok: true }) })).status, "passed", "잔액을 안 읽어도 된다");
  assert.equal((await runFlow(driver(false), flow, { now: () => 0, waitForScreen: async () => ({ ok: true }) })).status, "passed", "광고가 안 떠도 문구가 나오면 통과");
  const noText = { ...driver(false), expectText: async () => Promise.reject(new Error('"정답" 문구가 10000ms 안에 나오지 않았습니다.')) } as unknown as ScreenDriver;
  const missing = await runFlow(noText, flow, { now: () => 0, waitForScreen: async () => ({ ok: true }) });
  assert.match(missing.message ?? "", /3단계 문구 확인 「정답」 실패/);
}


// 잔액 정규식이 없는 앱은 잔액 적립을 잴 수 없다고 알린다(누르지 않는다)
{
  const steps = stepsOf([{ type: "watchAd", target: { role: "button", name: "광고" } }], sampleApp.guard.forbiddenClickNames);
  assert.ok(Array.isArray(steps));
  const pressed: string[] = [];
  const driver = { app: sampleApp, goHome: async () => undefined, currentPath: async () => "/home", clickButton: async (name: string) => void pressed.push(name), watchAd: async () => ({ shown: false }) } as unknown as ScreenDriver;
  const result = await runFlow(driver, { ...(validate(good) as FlowDocument), steps }, { now: () => 0, waitForScreen: async () => ({ ok: true }) });
  assert.match(result.message ?? "", /ads\.balancePattern/);
  assert.deepEqual(pressed, []);
}

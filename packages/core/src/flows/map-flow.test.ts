import { stepsOf as stepsOfForRelaunch } from "./schema";
import assert from "node:assert/strict";

import type { MapEdge } from "../device/screen-map";
import { sampleApp } from "../config/sample-app";
import { blocksAt as blocksWith, hasChangingValue, mapFlowError as errorWith, mapRulesOf, replay as replayWith } from "./map-flow";
import type { FlowStep } from "./schema";

const edges: MapEdge[] = [
  { from: "/benefit", role: "button", name: "적립 내역 보기", kind: "navigate", to: "/benefit/history", texts: ["적립 내역"], seenAt: "" },
  { from: "/benefit", role: "button", name: "OX퀴즈", kind: "popup", texts: ["4초"], seenAt: "" },
  { from: "/benefit", role: "button", name: "광고 시청", kind: "dead", seenAt: "" },
  { from: "/benefit", role: "button", name: "구매하기", kind: "navigate", to: "/buy", seenAt: "" },
];
// 예시 앱: 탭 4개(홈·카테고리·혜택·마이), 홈 경로 /home
const rules = mapRulesOf(sampleApp);
const blocksAt = (list: MapEdge[], path: string) => blocksWith(list, path, rules);
const mapFlowError = (list: MapEdge[], steps: FlowStep[]) => errorWith(list, steps, rules);
const replay = (list: MapEdge[], steps: FlowStep[]) => replayWith(list, steps, rules);
const click = (name: string, role: "button" | "link" = "button"): FlowStep => ({ type: "click", target: { role, name } });
const expect = (text: string): FlowStep => ({ type: "expectText", text });

// 블록: 탭 4개 + 이동·팝업. 반응 없음·금지 버튼은 뺀다
{
  const names = blocksAt(edges, "/benefit").map((block) => block.step.target.name);
  assert.deepEqual(names.slice(4), ["적립 내역 보기", "OX퀴즈"]);
  assert.equal(blocksAt(edges, "/home").length, 4);
}

// 홈 → 혜택 탭 → 내역 → 문구 확인
{
  const steps = [click("혜택", "link"), click("적립 내역 보기"), expect("적립 내역")];
  assert.equal(mapFlowError(edges, steps), null);
  const end = replay(edges, steps);
  assert.equal(typeof end === "string" ? end : end.path, "/benefit/history");
}

// 팝업 뒤에는 문구 확인과 홈으로만. 홈 블록은 처음으로 돌아간다
{
  const steps = [click("혜택", "link"), click("OX퀴즈"), expect("4초"), { type: "home" } as FlowStep, click("혜택", "link"), click("적립 내역 보기"), expect("적립 내역")];
  assert.equal(mapFlowError(edges, steps), null);
  const popup = replay(edges, [click("혜택", "link"), click("OX퀴즈")]);
  assert.equal(typeof popup === "string" ? popup : popup.popup, true);
  assert.match(mapFlowError(edges, [click("혜택", "link"), click("OX퀴즈"), click("적립 내역 보기"), expect("적립 내역")]) ?? "", /3번째 블록: 팝업이 떠 있어/);
}

// 입력은 지금 화면에 남는다: 누르기, 입력, 문구 확인
{
  const fill: FlowStep = { type: "fill", label: "수량", value: "3" };
  const steps = [click("혜택", "link"), click("적립 내역 보기"), fill, expect("적립 내역")];
  assert.equal(mapFlowError(edges, steps), null);
  const end = replay(edges, steps);
  assert.equal(typeof end === "string" ? end : end.path, "/benefit/history");
}

// 날마다 바뀌는 값이 든 버튼·문구는 후보에서 뺀다
{
  const priced: MapEdge[] = [
    { from: "/my", role: "button", name: "포인트 1.5% 278,358원", kind: "popup", texts: ["보유 포인트"], seenAt: "" },
    { from: "/my", role: "button", name: "배송지 등록하기", kind: "navigate", to: "/my/address", texts: ["배송지 정보를 입력해 주세요", "적립금 128,000원"], seenAt: "" },
  ];
  const blocks = blocksAt(priced, "/my").slice(4);
  assert.deepEqual(blocks.map((block) => block.step.target.name), ["배송지 등록하기"]);
  assert.deepEqual(blocks[0].texts, ["배송지 정보를 입력해 주세요"]);
  assert.equal(hasChangingValue("1:1 문의"), false);
  assert.equal(hasChangingValue("OX퀴즈"), false);
  assert.equal(hasChangingValue("3.75g"), true);
}

// 실패: 지금 화면에 없는 버튼 / 앞 블록 뒤에 안 보인 문구 / 문구 확인 없음 / 누르기 없음
assert.match(mapFlowError(edges, [click("적립 내역 보기"), expect("적립 내역")]) ?? "", /1번째 블록: 「적립 내역 보기」는 \/home/);
assert.match(mapFlowError(edges, [click("혜택", "link"), click("적립 내역 보기"), expect("4초")]) ?? "", /3번째 블록/);
assert.equal(mapFlowError(edges, [click("혜택", "link")]), "문구 확인 블록이 없습니다.");
assert.equal(mapFlowError(edges, [expect("적립 내역")]), "누르는 블록이 없습니다.");

console.log("map-flow ok");

// 앱 다시 켜기 스텝: 플로우로는 쓸 수 있고, 화면 지도로는 이어 붙이지 않는다
{
  const steps = stepsOfForRelaunch([{ type: "relaunch" }, { type: "click", target: { role: "button", name: "이벤트 배너" } }, { type: "expectText", text: "나의 초대 코드" }], sampleApp.guard.forbiddenClickNames);
  assert.ok(Array.isArray(steps));
  assert.deepEqual(steps[0], { type: "relaunch" });
}

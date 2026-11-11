import assert from "node:assert/strict";

import type { MapEdge } from "../device/screen-map";
import { sampleApp } from "../config/sample-app";
import { blocksAt as blocksWith, mapFlowError as errorWith, mapRulesOf, replay as replayWith } from "./map-flow";
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

// 팝업은 같은 화면에 남아 다음 버튼을 누를 수 있다. 홈 블록은 처음으로 돌아간다
{
  const steps = [click("혜택", "link"), click("OX퀴즈"), expect("4초"), click("적립 내역 보기"), { type: "home" } as FlowStep, click("혜택", "link"), click("OX퀴즈"), expect("4초")];
  assert.equal(mapFlowError(edges, steps), null);
}

// 실패: 지금 화면에 없는 버튼 / 앞 블록 뒤에 안 보인 문구 / 문구 확인 없음 / 누르기 없음
assert.match(mapFlowError(edges, [click("적립 내역 보기"), expect("적립 내역")]) ?? "", /1번째 블록: 「적립 내역 보기」는 \/home/);
assert.match(mapFlowError(edges, [click("혜택", "link"), click("적립 내역 보기"), expect("4초")]) ?? "", /3번째 블록/);
assert.equal(mapFlowError(edges, [click("혜택", "link")]), "문구 확인 블록이 없습니다.");
assert.equal(mapFlowError(edges, [expect("적립 내역")]), "누르는 블록이 없습니다.");

console.log("map-flow ok");

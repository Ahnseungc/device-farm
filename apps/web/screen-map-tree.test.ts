import assert from "node:assert/strict";

import type { MapEdge } from "@device-farm/core/device/screen-map";

import { buildScreenTree } from "./screen-map-tree";

const edge = (from: string, name: string, to?: string): MapEdge => ({ from, role: "button", name, kind: to ? "navigate" : "popup", ...(to ? { to } : {}), seenAt: "" });

// 홈 → 혜택 → 출석체크, 출석체크 → 홈(순환)은 다시 펼치지 않는다. 기록 없는 도착 화면은 unvisited.
{
  const tree = buildScreenTree([
    edge("/home", "혜택", "/benefit"),
    edge("/home", "팝업"),
    edge("/benefit", "출석체크", "/benefit/attendance"),
    edge("/benefit/attendance", "홈", "/home"),
    edge("/benefit/attendance", "알림", "/alarm"),
  ], "/home");
  assert.equal(tree.length, 1);
  const [home] = tree;
  assert.equal(home.path, "/home");
  const attendance = home.edges[0].child?.edges[0].child;
  assert.equal(attendance?.path, "/benefit/attendance");
  assert.equal(attendance?.edges[0].child?.repeated, true);
  assert.equal(attendance?.edges[1].child?.unvisited, true);
  assert.equal(home.edges[1].child, undefined);
}

// 모두 순환이면 기록한 화면이 뿌리가 된다
{
  const tree = buildScreenTree([edge("/a", "b", "/b"), edge("/b", "a", "/a")], "/home");
  assert.deepEqual(tree.map((node) => node.path), ["/a"]);
}

console.log("screen-map-tree ok");

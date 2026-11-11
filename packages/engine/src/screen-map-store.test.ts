import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { ButtonResult } from "@device-farm/core/device/button-check";
import { edgesFrom } from "@device-farm/core/device/screen-map";

import { readScreenMap, recordScreenMap } from "./screen-map-store";

const results: ButtonResult[] = [
  { role: "link", name: "출석체크", status: "reacted", message: "/benefit/attendance로 이동", to: "/benefit/attendance?stackRouter=1", texts: ["출석체크"] },
  { role: "button", name: "레벨 안내", status: "reacted", message: "화면 내용 바뀜", texts: ["레벨 안내"] },
  { role: "button", name: "장식", status: "dead" },
  { role: "button", name: "저장", status: "error", message: "POST /x 500" },
  { role: "button", name: "사라짐", status: "skipped", message: "못 찾음" },
];

// 이동·팝업·반응 없음·에러를 간선으로. 쿼리는 빼고, 누르지 못한 버튼은 남기지 않는다.
{
  const edges = edgesFrom("/benefit/", results, "2026-10-29T00:00:00.000Z");
  assert.deepEqual(
    edges.map((edge) => [edge.from, edge.name, edge.kind, edge.to ?? null]),
    [
      ["/benefit", "출석체크", "navigate", "/benefit/attendance"],
      ["/benefit", "레벨 안내", "popup", null],
      ["/benefit", "장식", "dead", null],
      ["/benefit", "저장", "error", null],
    ],
  );
  assert.equal(edges[3].message, "POST /x 500");
}

// 파일에 합칠 때 같은 화면·버튼은 새 결과로 바꾸고, 다른 화면 간선은 남긴다.
{
  const file = path.join(mkdtempSync(path.join(tmpdir(), "screen-map-")), "screen-map.json");
  assert.deepEqual(readScreenMap(file), { edges: [] });
  recordScreenMap("/benefit", results, file, new Date("2026-10-29T00:00:00Z"));
  recordScreenMap("/home", [{ role: "link", name: "포인트 내역 보기", status: "reacted", to: "/point" }], file);
  recordScreenMap("/benefit", [{ role: "button", name: "장식", status: "reacted", message: "화면 내용 바뀜" }], file);
  const edges = readScreenMap(file).edges;
  assert.equal(edges.length, 5);
  assert.equal(edges.find((edge) => edge.name === "장식")?.kind, "popup");
  assert.equal(edges.find((edge) => edge.from === "/home")?.to, "/point");
}

console.log("screen-map ok");

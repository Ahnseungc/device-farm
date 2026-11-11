import assert from "node:assert/strict";

import { buildFrontFigmaMap, parseGrepLine, routeOfFile } from "./front-figma";

// 라우트 그룹은 빼고, 비공개 폴더에서 멈추고, 동적 세그먼트는 *
assert.equal(routeOfFile("app/(protected)/(my)/my/withdraw/_src/organisms/A/A.tsx"), "/my/withdraw");
assert.equal(routeOfFile("app/(protected)/(my)/my/withdraw/[withdrawalId]/page.tsx"), "/my/withdraw/*");
assert.equal(routeOfFile("app/page.tsx"), "/");
assert.equal(routeOfFile("containers/A.tsx"), null);

const ref = "origin/development";
const line = parseGrepLine(`${ref}:app/(a)/x/_src/A.stories.tsx:8:  "https://www.figma.com/design/KEY1/?node-id=42570-336184";`, ref);
assert.deepEqual(line, { file: "app/(a)/x/_src/A.stories.tsx", text: '  "https://www.figma.com/design/KEY1/?node-id=42570-336184";' });

// 주석 노드는 같은 화면 링크의 파일 키, 없으면 전체에서 가장 많은 키
const map = buildFrontFigmaMap([
  line!,
  { file: "app/(a)/x/_src/B.tsx", text: "/** Figma 42604:347085 — 요약 */" },
  { file: "app/y/_src/C.tsx", text: "// Figma 1:2" },
  { file: "app/z/_src/D.stories.tsx", text: "figma.com/file/KEY2/a?node-id=3%3A4" },
]);
assert.deepEqual(map["/x"], ["KEY1:42570:336184", "KEY1:42604:347085"]);
assert.deepEqual(map["/z"], ["KEY2:3:4"]);
assert.equal(map["/y"].length, 1);

console.log("front figma ok");

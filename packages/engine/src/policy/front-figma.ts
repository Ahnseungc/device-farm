import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { buildFrontFigmaMap, parseGrepLine, type FrontFigmaLine } from "@device-farm/core/policy/front-figma";

import { policyRoot } from "./store";
import { writeJsonFile } from "./rules-store";

/** 앱이 실제로 배포되는 브랜치. 앱 설정 `figma.ref`가 덮는다 */
export const defaultFrontRef = "origin/main";
/** grep 출력 상한. 피그마 줄만 모으니 넉넉하다 (작성자 판단) */
const grepMaxBuffer = 32 * 1024 * 1024;

export interface FrontFigmaMap {
  ref: string;
  commit: string;
  builtAt: string;
  /** 화면 경로(`*` 포함) → `fileKey:nodeId` */
  routes: Record<string, string[]>;
}

const mapFile = (root: string) => path.join(root, "front-figma.json");

export function readFrontFigmaMap(root = policyRoot): FrontFigmaMap | null {
  if (!existsSync(mapFile(root))) return null;
  try {
    return JSON.parse(readFileSync(mapFile(root), "utf8")) as FrontFigmaMap;
  } catch {
    // 반쯤 쓴 파일은 없는 것과 같다. 다음 갱신 때 다시 만든다.
    return null;
  }
}

/** 프론트 체크아웃(앱 설정 `figma.frontRepo` 또는 FLOW_PRD_ROOT)에서 원격 브랜치를 받아 화면 → 피그마 노드를 만든다. 작업 트리는 건드리지 않는다 */
export function buildFrontFigma(frontRoot: string, ref = defaultFrontRef, now = new Date(), root = policyRoot, appDir = "app"): FrontFigmaMap {
  const git = (...args: string[]) => execFileSync("git", ["-C", frontRoot, ...args], { encoding: "utf8", maxBuffer: grepMaxBuffer });
  const [remote, ...branch] = ref.split("/");
  try {
    git("fetch", "-q", remote, branch.join("/"));
  } catch {
    // 네트워크가 없으면 마지막으로 받은 ref로 만든다.
  }
  const commit = git("rev-parse", "--short", ref).trim();
  let output = "";
  try {
    output = git("grep", "-n", "-E", "figma\\.com/(design|file|proto)/|Figma [0-9]+:[0-9]+", ref, "--", appDir);
  } catch (error) {
    // git grep은 찾은 게 없으면 1로 끝난다.
    if ((error as { status?: number }).status !== 1) throw error;
  }
  const lines = output
    .split("\n")
    .map((line) => parseGrepLine(line, ref))
    .filter((line): line is FrontFigmaLine => line !== null);
  const map: FrontFigmaMap = { ref, commit, builtAt: now.toISOString(), routes: buildFrontFigmaMap(lines, appDir) };
  writeJsonFile(mapFile(root), map);
  return map;
}

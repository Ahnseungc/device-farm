// 플로우 저장소. PRD는 프론트 체크아웃(FLOW_PRD_ROOT)의 스펙 문서를 읽는다.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

import { isPrdName, validateGenerated, type FlowDocument } from "@device-farm/core/flows/schema";

const flowSources: readonly FlowDocument["source"][] = ["ai_generated", "map_built", "recorded"];

export interface FlowDirs {
  /** 확정 플로우. 레포에 커밋한다. */
  ready: string;
  /** 후보·PRD 해시. 커밋하지 않는다. */
  generated: string;
}

export const flowDirs: FlowDirs = {
  ready: path.resolve("scenarios/flows"),
  generated: path.resolve("test-results/flows/generated"),
};

/** PRD를 찾는 폴더(FLOW_PRD_ROOT 기준). App Router `_src/specs`와 `docs/specs`. */
const prdSearchRoots = ["app", "docs/specs"] as const;
const skippedDirs = new Set(["node_modules", ".git", ".next"]);

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    // 없는 파일은 빈 목록과 같다.
    return fallback;
  }
}

function writeJson(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

export function prdRoot(): string | null {
  const root = process.env.FLOW_PRD_ROOT?.trim();
  return root && existsSync(root) ? realpathSync(root) : null;
}

function walkMarkdown(dir: string, inSpecs: boolean, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (skippedDirs.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkMarkdown(full, inSpecs || entry.name === "specs", out);
    else if (inSpecs && entry.name.endsWith(".md")) out.push(full);
  }
}

/** 고를 수 있는 PRD(스펙 문서) 목록. FLOW_PRD_ROOT 상대 경로. */
export function listPrds(root = prdRoot()): string[] {
  if (!root) return [];
  const files: string[] = [];
  for (const sub of prdSearchRoots) {
    const dir = path.join(root, sub);
    if (existsSync(dir)) walkMarkdown(dir, sub === "docs/specs", files);
  }
  return files.map((file) => path.relative(root, file).split(path.sep).join("/")).filter(isPrdName).sort();
}

export function readPrd(name: string, root = prdRoot()): string | null {
  if (!root || !isPrdName(name)) return null;
  const file = path.resolve(root, name);
  if (!file.startsWith(root + path.sep) || !existsSync(file)) return null;
  return readFileSync(file, "utf8");
}

export function prdHash(body: string): string {
  return createHash("sha256").update(body, "utf8").digest("hex");
}

const hashFile = (dirs: FlowDirs) => path.join(dirs.generated, "hashes.json");
const candidateFile = (dirs: FlowDirs) => path.join(dirs.generated, "scenarios.json");

export function readHashes(dirs = flowDirs): Record<string, string> {
  return readJson(hashFile(dirs), {} as Record<string, string>);
}

export function writeHash(name: string, hash: string, dirs = flowDirs): void {
  writeJson(hashFile(dirs), { ...readHashes(dirs), [name]: hash });
}

export function readCandidates(dirs = flowDirs): FlowDocument[] {
  const parsed = readJson(candidateFile(dirs), { items: [] as FlowDocument[] });
  return Array.isArray(parsed.items) ? parsed.items : [];
}

/** 이번 PRD의 후보로 바꾼다. 다른 PRD의 후보는 남긴다. */
export function writeCandidates(prd: string, items: FlowDocument[], dirs = flowDirs): void {
  writeJson(candidateFile(dirs), { items: [...readCandidates(dirs).filter((item) => item.prd !== prd), ...items] });
}

/** 후보 하나를 더한다. 같은 id 후보는 바꾼다. 화면 지도 조립처럼 PRD 단위로 묶이지 않는 후보용. */
export function addCandidate(item: FlowDocument, dirs = flowDirs): void {
  writeJson(candidateFile(dirs), { items: [...readCandidates(dirs).filter((entry) => entry.id !== item.id), item] });
}

export function readReady(dirs = flowDirs): FlowDocument[] {
  if (!existsSync(dirs.ready)) return [];
  return readdirSync(dirs.ready)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .flatMap((name) => {
      const parsed = readJson<FlowDocument | null>(path.join(dirs.ready, name), null);
      return parsed && parsed.status === "ready" && flowSources.includes(parsed.source) ? [parsed] : [];
    });
}

export function acceptGenerated(items: unknown[], prd: string, prdBody: string, forbiddenClickNames: readonly string[], dirs = flowDirs): FlowDocument[] {
  const readyIds = new Set(readReady(dirs).map((item) => item.id));
  return items.map((item, index) => validateGenerated(item, index, readyIds, prd, prdBody, forbiddenClickNames));
}

function readyDocument(item: FlowDocument): FlowDocument {
  return { id: item.id, name: item.name, source: item.source, status: "ready", prd: item.prd, requirement: item.requirement, steps: item.steps };
}

/** 후보 하나를 확정한다. delete 제안이면 확정 파일을 지운다. keep·검증 실패는 확정할 수 없다. */
export function confirmFlow(id: string, dirs = flowDirs): boolean {
  const items = readCandidates(dirs);
  const item = items.find((entry) => entry.id === id && entry.status === "generated");
  if (!item || !item.proposal || item.proposal === "keep") return false;
  const file = path.join(dirs.ready, `${item.id}.json`);
  if (item.proposal === "delete") {
    if (existsSync(file)) unlinkSync(file);
  } else {
    writeJson(file, readyDocument(item));
  }
  writeJson(candidateFile(dirs), { items: items.filter((entry) => entry.id !== id) });
  return true;
}

/** ids를 안 주면 확정할 수 있는 후보 전부. 확정한 수를 돌려준다. */
export function confirmFlows(ids?: readonly string[], dirs = flowDirs): number {
  const targets = ids ?? readCandidates(dirs).filter((item) => item.status === "generated").map((item) => item.id);
  return targets.filter((id) => confirmFlow(id, dirs)).length;
}

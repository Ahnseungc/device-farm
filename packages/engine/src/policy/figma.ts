import { shortHash } from "@device-farm/core/policy/rules";

import type { FetchLike } from "./confluence";

/**
 * 피그마 노드의 문구(TEXT 노드 글자)를 읽는다(설계 문서 「피그마에서 뽑는 것」). 읽기 전용 개인 토큰(X-Figma-Token). LLM 없음.
 * 노드는 정책 본문에 적힌 피그마 링크에서 찾는다.
 */

/** `fileKey:nodeId` (nodeId는 `12:34`) */
export type FigmaRef = string;

/** 정책 본문(storage)에 적힌 피그마 링크. `node-id=12-34`·`12%3A34` 둘 다 `12:34`로 */
export function figmaRefs(storage: string): FigmaRef[] {
  const refs = new Set<FigmaRef>();
  const pattern = /figma\.com\/(?:design|file|proto)\/([A-Za-z0-9]+)[^"'\s<>]*?node-id=([0-9]+(?:-|%3A|:)[0-9]+)/g;
  for (const match of storage.replaceAll("&amp;", "&").matchAll(pattern)) {
    refs.add(`${match[1]}:${decodeURIComponent(match[2]).replace("-", ":")}`);
  }
  return [...refs].sort();
}

type FigmaNode = { type?: string; characters?: string; children?: FigmaNode[] };
type NodesResponse = { nodes?: Record<string, { document?: FigmaNode } | null> };

function collectTexts(node: FigmaNode | undefined, into: string[]): void {
  if (!node) return;
  if (node.type === "TEXT" && node.characters?.trim()) into.push(node.characters.trim());
  for (const child of node.children ?? []) collectTexts(child, into);
}

export interface FigmaTexts {
  hash: string;
  texts: string[];
}

/** 파일별로 묶어 한 번에 부른다. 노드 하나가 없거나 권한이 없으면 그 노드만 빈다 */
export async function fetchFigmaTexts(token: string, refs: readonly FigmaRef[], fetchImpl: FetchLike): Promise<Record<FigmaRef, FigmaTexts>> {
  const byFile = new Map<string, string[]>();
  for (const ref of refs) {
    const [fileKey, ...rest] = ref.split(":");
    byFile.set(fileKey, [...(byFile.get(fileKey) ?? []), rest.join(":")]);
  }
  const result: Record<FigmaRef, FigmaTexts> = {};
  for (const [fileKey, ids] of byFile) {
    const response = await fetchImpl(`https://api.figma.com/v1/files/${fileKey}/nodes?ids=${encodeURIComponent(ids.join(","))}`, { headers: { "X-Figma-Token": token } });
    if (!response.ok) throw new Error(`Figma ${response.status}: ${fileKey}`);
    const body = (await response.json()) as NodesResponse;
    for (const id of ids) {
      const texts: string[] = [];
      collectTexts(body.nodes?.[id]?.document, texts);
      result[`${fileKey}:${id}`] = { hash: shortHash(texts.join("\n")), texts };
    }
  }
  return result;
}

/** 노드가 있는 피그마 페이지를 찾을 때 한 번에 묻는 노드 수 (작성자 판단, 응답에 노드 하위가 다 실려 커진다) */
const pageLookupChunk = 20;

type FileResponse = { document?: { children?: (FigmaNode & { id?: string })[] } };

function collectIds(node: (FigmaNode & { id?: string }) | undefined, into: Set<string>): void {
  if (!node) return;
  if (node.id) into.add(node.id);
  for (const child of node.children ?? []) collectIds(child as FigmaNode & { id?: string }, into);
}

/**
 * 노드 → 그 노드가 있는 피그마 페이지(`fileKey:pageId`). `files/:key?ids=`는 요청한 노드가 든 페이지만 하위를 채워 돌려준다.
 * 시트·팝업·필터 같은 다른 상태는 보통 같은 페이지의 다른 프레임에 그린다(2026-11-12, 「유의사항을 확인해 주세요」 등).
 */
export async function fetchFigmaPagesOf(token: string, refs: readonly FigmaRef[], fetchImpl: FetchLike): Promise<Record<FigmaRef, FigmaRef>> {
  const byFile = new Map<string, string[]>();
  for (const ref of refs) {
    const [fileKey, ...rest] = ref.split(":");
    byFile.set(fileKey, [...(byFile.get(fileKey) ?? []), rest.join(":")]);
  }
  const result: Record<FigmaRef, FigmaRef> = {};
  for (const [fileKey, ids] of byFile) {
    for (let start = 0; start < ids.length; start += pageLookupChunk) {
      const chunk = ids.slice(start, start + pageLookupChunk);
      const response = await fetchImpl(`https://api.figma.com/v1/files/${fileKey}?ids=${encodeURIComponent(chunk.join(","))}`, { headers: { "X-Figma-Token": token } });
      if (!response.ok) throw new Error(`Figma ${response.status}: ${fileKey}`);
      const body = (await response.json()) as FileResponse;
      for (const page of body.document?.children ?? []) {
        if (!page.id || (page.children ?? []).length === 0) continue;
        const inside = new Set<string>();
        collectIds(page, inside);
        for (const id of chunk) if (inside.has(id)) result[`${fileKey}:${id}`] = `${fileKey}:${page.id}`;
      }
    }
  }
  return result;
}

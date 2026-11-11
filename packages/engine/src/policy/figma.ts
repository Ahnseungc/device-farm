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

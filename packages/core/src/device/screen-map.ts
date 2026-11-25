import type { ButtonResult } from "./button-check";
import type { ClickRole } from "./driver";
import { normalizePath } from "./screen-ready";

/**
 * 화면 지도: 화면(경로)마다 어떤 버튼·링크를 누르면 무슨 일이 나는지. 버튼 눌러보기 결과를 모은다.
 * 계정 상태에 따라 달라지므로 커밋하지 않고 `test-results/`에 둔다. 플로우를 조립·녹화할 때 고를 블록의 근거다.
 */

/** navigate: 다른 화면으로 감. popup: 같은 화면에서 팝업·시트·내용이 바뀜. dead: 반응 없음. error: 앱 오류·네트워크 실패 */
export type MapEdgeKind = "navigate" | "popup" | "dead" | "error";

export interface MapEdge {
  /** 쿼리를 뺀 경로 */
  from: string;
  role: ClickRole;
  name: string;
  kind: MapEdgeKind;
  to?: string;
  texts?: string[];
  message?: string;
  /** 마지막으로 본 시각(ISO). 같은 버튼은 새 결과로 바꾼다. */
  seenAt: string;
}

export interface ScreenMap {
  edges: MapEdge[];
}

function edgeKind(result: ButtonResult): MapEdgeKind | null {
  if (result.status === "skipped") return null;
  if (result.status === "reacted") return result.to ? "navigate" : "popup";
  return result.status;
}

/** 한 화면의 버튼 결과를 지도 간선으로. 누르지 못한(skipped) 버튼은 남기지 않는다. */
/** 시나리오 고치기 프롬프트에 넣는 화면 지도 줄 수·화면당 버튼 수 (작성자 판단) */
export const mapSummaryScreens = 60;
export const mapSummaryButtons = 15;

/** 화면마다 실제로 본 버튼(반응 없음·에러 제외) 한 줄씩: `- /path: 「이름」→/to, 「이름」(팝업)` */
export function screenMapSummary(edges: readonly MapEdge[]): string {
  const byScreen = new Map<string, MapEdge[]>();
  for (const edge of edges) {
    if (edge.kind === "dead" || edge.kind === "error") continue;
    byScreen.set(edge.from, [...(byScreen.get(edge.from) ?? []), edge]);
  }
  const label = (edge: MapEdge) => `「${edge.name}」${edge.kind === "popup" ? "(팝업)" : edge.to ? `→${edge.to}` : ""}`;
  return [...byScreen]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(0, mapSummaryScreens)
    .map(([from, list]) => `- ${from}: ${list.slice(0, mapSummaryButtons).map(label).join(", ")}`)
    .join("\n");
}

export function edgesFrom(from: string, results: readonly ButtonResult[], seenAt: string): MapEdge[] {
  return results.flatMap((result) => {
    const kind = edgeKind(result);
    if (!kind) return [];
    const edge: MapEdge = { from: normalizePath(from), role: result.role, name: result.name, kind, seenAt };
    if (result.to) edge.to = normalizePath(result.to);
    if (result.texts && result.texts.length > 0) edge.texts = result.texts;
    if (kind === "error" && result.message) edge.message = result.message;
    return [edge];
  });
}

const edgeKey = (edge: MapEdge) => `${edge.from}\u0000${edge.role}\u0000${edge.name}`;

/** 같은 화면·역할·이름은 새 간선으로 바꾼다. 경로·이름 순으로 정렬한다. */
export function mergeEdges(current: readonly MapEdge[], next: readonly MapEdge[]): MapEdge[] {
  const merged = new Map(current.map((edge) => [edgeKey(edge), edge]));
  for (const edge of next) merged.set(edgeKey(edge), edge);
  return [...merged.values()].sort((a, b) => (edgeKey(a) < edgeKey(b) ? -1 : edgeKey(a) > edgeKey(b) ? 1 : 0));
}

import type { MapEdge } from "@device-farm/core/device/screen-map";

/** 트리 한 칸. 화면 노드 아래에 그 화면의 간선, 이동 간선 아래에 도착 화면이 온다. */
export interface ScreenNode {
  path: string;
  edges: EdgeNode[];
  /** 이미 위에서 펼친 화면이면 다시 펼치지 않는다(순환·중복 방지) */
  repeated?: boolean;
  /** 지도에 이 화면에서 누른 기록이 없다(버튼 눌러보기를 아직 안 돌림) */
  unvisited?: boolean;
}

export interface EdgeNode {
  edge: MapEdge;
  child?: ScreenNode;
}

/** 홈 화면이 첫 뿌리, 그다음은 다른 화면에서 이동해 오지 않는 화면(하단 탭 화면 등). */
function rootsOf(edges: readonly MapEdge[], froms: readonly string[], homePath: string): string[] {
  const reached = new Set(edges.filter((edge) => edge.to && edge.to !== edge.from).map((edge) => edge.to));
  const unreached = froms.filter((from) => from !== homePath && !reached.has(from));
  return froms.includes(homePath) ? [homePath, ...unreached] : unreached;
}

/** 화면 지도 간선을 뿌리 화면부터 펼친 트리로. 한 화면은 처음 만난 곳에서 한 번만 펼친다. */
export function buildScreenTree(edges: readonly MapEdge[], homePath: string): ScreenNode[] {
  const byFrom = new Map<string, MapEdge[]>();
  for (const edge of edges) byFrom.set(edge.from, [...(byFrom.get(edge.from) ?? []), edge]);
  const expanded = new Set<string>();
  const expand = (path: string): ScreenNode => {
    if (expanded.has(path)) return { path, edges: [], repeated: true };
    expanded.add(path);
    const own = byFrom.get(path);
    if (!own) return { path, edges: [], unvisited: true };
    return { path, edges: own.map((edge) => (edge.kind === "navigate" && edge.to ? { edge, child: expand(edge.to) } : { edge })) };
  };
  const roots = rootsOf(edges, [...byFrom.keys()], homePath).map(expand);
  // 뿌리에서 닿지 않은 순환 묶음도 빠뜨리지 않는다. 앞 묶음에서 펼쳐진 화면은 건너뛴다.
  const rest: ScreenNode[] = [];
  for (const path of byFrom.keys()) if (!expanded.has(path)) rest.push(expand(path));
  return [...roots, ...rest];
}

import type { ButtonResult } from "@device-farm/core/device/button-check";
import { edgesFrom, mergeEdges, type MapEdge, type ScreenMap } from "@device-farm/core/device/screen-map";

import { all, farmDb, fromJson, transaction, type FarmDb } from "./db/farm-db";

/** 화면 지도(farm.db `screen_map_edges`). 계정 상태에 따라 달라지므로 커밋하지 않는다. 아직 버튼 눌러보기를 안 돌렸으면 빈 지도. */
export function readScreenMap(db: FarmDb = farmDb()): ScreenMap {
  const rows = all<{ from_path: string; name: string; data: string }>(db, "SELECT from_path, name, data FROM screen_map_edges");
  return { edges: mergeEdges([], rows.map((row) => fromJson<MapEdge>(row.data, `screen_map_edges(${row.from_path} ${row.name})`))) };
}

/** 간선을 넣거나 바꾼다. 같은 화면·역할·이름은 새 간선으로 바꾼다(mergeEdges와 같은 키). */
export function upsertEdges(edges: readonly MapEdge[], db: FarmDb = farmDb()): void {
  transaction(db, () => {
    const upsert = db.prepare(
      `INSERT INTO screen_map_edges (from_path, role, name, kind, to_path, seen_at, data) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (from_path, role, name) DO UPDATE SET kind = excluded.kind, to_path = excluded.to_path, seen_at = excluded.seen_at, data = excluded.data`,
    );
    for (const edge of edges) upsert.run(edge.from, edge.role, edge.name, edge.kind, edge.to ?? null, edge.seenAt, JSON.stringify(edge));
  });
}

/** 한 화면 결과를 지도에 합친다 */
export function recordScreenMap(from: string, results: readonly ButtonResult[], db: FarmDb = farmDb(), now = new Date()): void {
  upsertEdges(edgesFrom(from, results, now.toISOString()), db);
}


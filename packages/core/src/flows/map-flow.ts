import { tabNamesOf, type AppConfig, type AppNavigation } from "../config/app-config";
import type { MapEdge } from "../device/screen-map";
import type { FlowStep } from "./schema";

/**
 * 화면 지도로 플로우 조립: 홈에서 시작해 지금 화면에서 누를 수 있는 블록을 하나씩 이어 붙인다.
 * 브라우저(빌더)와 서버(검증)가 같이 쓰므로 node 모듈을 쓰지 않는다.
 */

/** 지도 조립에 쓰는 앱 설정: 홈·탭(`AppNavigation`)과 금지 버튼 */
export type MapRules = Pick<AppNavigation, "homePath" | "homeTabName" | "tabPaths"> & { forbiddenClickNames: readonly string[] };

export function mapRulesOf(app: AppConfig): MapRules {
  return { homePath: app.homePath, homeTabName: app.homeTabName, tabPaths: app.tabPaths, forbiddenClickNames: app.guard.forbiddenClickNames };
}

export const mapFlowPrd = "화면 지도";

/** 지금 화면에서 붙일 수 있는 누르기 블록. 누르면 `to` 화면이 된다(팝업은 같은 화면). */
export interface MapBlock {
  kind: "tab" | "navigate" | "popup";
  step: Extract<FlowStep, { type: "click" }>;
  to: string;
  /** 누른 뒤 지도에 남은 문구. 다음 문구 확인 블록의 후보 */
  texts: string[];
}

/** 지금 화면 상태: 어느 화면에 있고, 마지막으로 누른 블록 뒤 어떤 문구가 보였는지 */
export interface MapCursor {
  path: string;
  texts: string[];
}

export const startCursorOf = (rules: Pick<MapRules, "homePath">): MapCursor => ({ path: rules.homePath, texts: [] });

/** 하단 탭 링크 + 지도에서 이 화면의 이동·팝업 버튼. 반응 없음·에러·금지 버튼은 뺀다. */
export function blocksAt(edges: readonly MapEdge[], path: string, rules: MapRules): MapBlock[] {
  const tabs: MapBlock[] = tabNamesOf(rules).map((name) => ({ kind: "tab", step: { type: "click", target: { role: "link", name } }, to: rules.tabPaths[name], texts: [] }));
  const own = edges.flatMap((edge): MapBlock[] => {
    if (edge.from !== path || rules.forbiddenClickNames.includes(edge.name)) return [];
    const step = { type: "click", target: { role: edge.role, name: edge.name } } as const;
    if (edge.kind === "navigate" && edge.to) return [{ kind: "navigate", step, to: edge.to, texts: edge.texts ?? [] }];
    if (edge.kind === "popup") return [{ kind: "popup", step, to: path, texts: edge.texts ?? [] }];
    return [];
  });
  return [...tabs, ...own];
}

/** 스텝 하나를 지도 위에서 밟는다. 지도에 없는 버튼·안 보인 문구면 사유 문자열. */
export function advance(edges: readonly MapEdge[], cursor: MapCursor, step: FlowStep, rules: MapRules): MapCursor | string {
  if (step.type === "home") return startCursorOf(rules);
  if (step.type === "expectText") {
    return cursor.texts.includes(step.text) ? cursor : `「${step.text}」는 앞 블록을 누른 뒤 지도에 남은 문구가 아닙니다.`;
  }
  const block = blocksAt(edges, cursor.path, rules).find(
    (item) => item.step.target.role === step.target.role && item.step.target.name === step.target.name,
  );
  if (!block) return `「${step.target.name}」는 ${cursor.path} 화면 지도에 없는 버튼입니다.`;
  return { path: block.to, texts: block.texts };
}

/** 홈부터 스텝을 다시 밟아 본다. 끝난 화면 상태 또는 사유 문자열. */
export function replay(edges: readonly MapEdge[], steps: readonly FlowStep[], rules: MapRules): MapCursor | string {
  let cursor = startCursorOf(rules);
  for (const [index, step] of steps.entries()) {
    const next = advance(edges, cursor, step, rules);
    if (typeof next === "string") return `${index + 1}번째 블록: ${next}`;
    cursor = next;
  }
  return cursor;
}

/** 저장해도 되는 조립 결과인지. 문제가 없으면 null. */
export function mapFlowError(edges: readonly MapEdge[], steps: readonly FlowStep[], rules: MapRules): string | null {
  if (!steps.some((step) => step.type === "click")) return "누르는 블록이 없습니다.";
  if (!steps.some((step) => step.type === "expectText")) return "문구 확인 블록이 없습니다.";
  const result = replay(edges, steps, rules);
  return typeof result === "string" ? result : null;
}

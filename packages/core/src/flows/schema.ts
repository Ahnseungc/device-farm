/** 플로우 문서·스텝 모양과 검증. 금지 버튼 이름은 앱 설정(`AppConfig.guard.forbiddenClickNames`)에서 받는다. */
const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** FLOW_PRD_ROOT 기준 상대 경로. App Router 폴더 이름의 `( ) [ ]`와 `/`를 허용한다. */
const prdPattern = /^[A-Za-z0-9._()[\]/-]+\.md$/;

/** match가 prefix면 name으로 시작하는 버튼을 누른다. 레벨·금액처럼 계정 상태에 따라 바뀌는 이름에 쓴다. */
export type ClickTarget = { role: "button" | "link"; name: string; match?: "prefix" };

/** `home`은 점검기가 맨 앞에 넣는 시작 스텝이고, 플로우 중간에도 쓸 수 있다(홈으로 돌아가기). */
export type FlowStep = { type: "home" } | { type: "click"; target: ClickTarget } | { type: "expectText"; text: string };

export type FlowProposal = "keep" | "update" | "create" | "delete";

export type FlowDocument = {
  id: string;
  name: string;
  /** ai_generated: PRD로 LLM이 만든 것. map_built: 화면 지도에서 블록을 이어 붙인 것. recorded: 사람·에이전트 조작을 기록한 것 */
  source: "ai_generated" | "map_built" | "recorded";
  status: "generated" | "generation_failed" | "ready";
  prd: string;
  requirement: string;
  steps: FlowStep[];
  proposal?: FlowProposal;
  reason?: string;
};

/** 화면·진행 패널·실패 메시지가 같이 쓰는 스텝 이름. 브라우저에서도 읽으므로 이 파일은 node 모듈을 쓰지 않는다. */
export const stepLabels = { home: "홈에서 시작", click: "누르기", expectText: "문구 확인" } as const satisfies Record<FlowStep["type"], string>;

/** 스텝이 가리키는 이름. 홈 스텝은 홈 탭 이름 */
export function stepTarget(step: FlowStep, homeTabName = "홈"): string {
  if (step.type === "home") return homeTabName;
  if (step.type === "click") return step.target.match === "prefix" ? `${step.target.name}…` : step.target.name;
  return step.text;
}

export function isPrdName(name: string): boolean {
  return prdPattern.test(name) && !name.split("/").some((part) => part === ".." || part === "" || part === ".");
}

function failed(id: string, name: string, prd: string, requirement: string, reason: string): FlowDocument {
  return { id, name, source: "ai_generated", status: "generation_failed", prd, requirement, reason, steps: [] };
}

function stepOf(raw: unknown, forbiddenClickNames: readonly string[]): FlowStep | string {
  if (!raw || typeof raw !== "object") return "스텝 형식이 올바르지 않습니다.";
  const step = raw as { type?: unknown; path?: unknown; text?: unknown; target?: { role?: unknown; name?: unknown; match?: unknown } };
  // 플로우 중간에 홈 탭으로 돌아간다. 닫기 뒤 돌아가는 화면이 매번 다를 때 쓴다.
  if (step.type === "home") return { type: "home" };
  if (step.type === "navigate") return "플로우는 홈에서 버튼·링크로만 이동합니다. navigate는 쓸 수 없습니다.";
  if (step.type === "click") {
    const role = step.target?.role;
    if ((role !== "button" && role !== "link") || typeof step.target?.name !== "string" || !step.target.name) {
      return "버튼·링크 이름이 올바르지 않습니다.";
    }
    if (forbiddenClickNames.includes(step.target.name)) {
      return `「${step.target.name}」 버튼은 쓸 수 없습니다(금지 버튼).`;
    }
    if (step.target.match !== undefined && step.target.match !== "prefix") return "match는 prefix만 쓸 수 있습니다.";
    return { type: "click", target: { role, name: step.target.name, ...(step.target.match === "prefix" ? { match: "prefix" as const } : {}) } };
  }
  if (step.type === "expectText") {
    if (typeof step.text !== "string" || !step.text) return "기대 문구가 비어 있습니다.";
    return { type: "expectText", text: step.text };
  }
  return "지원하지 않는 동작입니다.";
}

function proposalError(proposal: unknown, id: string, readyIds: ReadonlySet<string>): string | null {
  if (proposal !== "keep" && proposal !== "update" && proposal !== "create" && proposal !== "delete") return "proposal이 올바르지 않습니다.";
  if (proposal !== "create" && !readyIds.has(id)) return "확정된 시나리오가 없습니다.";
  if (proposal === "create" && readyIds.has(id)) return "이미 확정된 시나리오입니다.";
  return null;
}

/** 스텝을 검증한다. 문자열이면 실패 사유. */
export function stepsOf(raw: unknown, forbiddenClickNames: readonly string[]): FlowStep[] | string {
  if (!Array.isArray(raw) || raw.length === 0) return "스텝이 없습니다.";
  const steps: FlowStep[] = [];
  for (const entry of raw) {
    const step = stepOf(entry, forbiddenClickNames);
    if (typeof step === "string") return step;
    steps.push(step);
  }
  if (!steps.some((step) => step.type === "click")) return "누르는 스텝이 없습니다.";
  if (!steps.some((step) => step.type === "expectText")) return "기대 문구가 없습니다.";
  return steps;
}

export function validateGenerated(
  raw: unknown,
  index: number,
  readyIds: ReadonlySet<string>,
  prd: string,
  prdBody: string,
  forbiddenClickNames: readonly string[],
): FlowDocument {
  const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const id = typeof record.id === "string" && idPattern.test(record.id) ? record.id : `invalid-${index + 1}`;
  const name = typeof record.name === "string" && record.name ? record.name : "이름 없는 플로우";
  const requirement = typeof record.requirement === "string" ? record.requirement : "";
  if (!requirement || !prdBody.includes(requirement)) return failed(id, name, prd, requirement || "요구 문장", "요구 문장이 PRD에 없습니다.");
  const proposal = record.proposal as FlowProposal;
  const wrongProposal = proposalError(proposal, id, readyIds);
  if (wrongProposal) return failed(id, name, prd, requirement, wrongProposal);
  const steps = stepsOf(record.steps, forbiddenClickNames);
  if (typeof steps === "string") return failed(id, name, prd, requirement, steps);
  return { id, name, source: "ai_generated", status: "generated", prd, requirement, proposal, steps };
}

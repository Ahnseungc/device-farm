// PRD → 플로우 후보 생성 프롬프트. 기기 실행에 맞춰 홈 시작·탭 링크 규칙을 넣는다.
import { tabNamesOf, type AppConfig } from "../config/app-config";
import type { FlowDocument } from "./schema";

export function parseModelJson(text: string): unknown[] | null {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function generationPrompt(input: { app: Pick<AppConfig, "name" | "homeTabName" | "tabPaths" | "guard">; prdName: string; prdBody: string; ready: FlowDocument[] }): string {
  const tabNames = tabNamesOf(input.app);
  const forbiddenClickNames = input.app.guard.forbiddenClickNames;
  return [
    `PRD에서 ${input.app.name} 앱 실기기 플로우 점검 후보를 JSON 배열로만 답한다.`,
    "동작은 click, expectText만 쓴다. 주소로 화면을 여는 동작은 없다.",
    `플로우는 앱 홈(${input.app.homeTabName} 탭)에서 시작한다. 점검기가 시작 전에 홈으로 보낸다. 다른 화면으로는 버튼과 링크를 눌러서만 간다.`,
    `하단 탭은 click.target.role link로 누른다. 탭 이름: ${tabNames.join(", ")}.`,
    "click.target.role은 button 또는 link이고 name은 화면에 보이는 문구와 정확히 같아야 한다.",
    "click 뒤에는 바뀐 화면의 문구를 expectText로 확인한다.",
    `${forbiddenClickNames.join(", ")} 버튼은 쓰지 않는다.`,
    "입력, 주문, 결제, 판매, 출금, 탈퇴, 본인인증 플로우는 만들지 않는다.",
    "expectText가 하나 이상 있어야 한다.",
    "requirement는 PRD에 있는 문장을 그대로 쓴다.",
    "proposal은 keep, update, create, delete 중 하나다.",
    "id는 영문 소문자와 숫자, 하이픈만 쓴다.",
    "source는 ai_generated다.",
    `PRD 파일: ${input.prdName}`,
    "확정된 시나리오:",
    JSON.stringify(input.ready.map((item) => ({ id: item.id, name: item.name, requirement: item.requirement, steps: item.steps }))),
    "PRD 본문:",
    input.prdBody,
  ].join("\n");
}

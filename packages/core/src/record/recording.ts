import type { ButtonResult } from "../device/button-check";
import type { ClickRole } from "../device/driver";
import { normalizePath } from "../device/screen-ready";
import type { FlowStep } from "../flows/schema";

/**
 * 조작 기록: 사람·에이전트가 Android 앱을 움직이는 동안 WebView에서 모은 클릭과 이동.
 * 클릭은 디바이스팜 누르기와 같은 이름 규칙(clickTargetHelpers)으로 남겨, 그대로 플로우 스텝·화면 지도 간선이 된다.
 */
export type RecordEvent =
  /** 버튼·링크 클릭. to·texts는 누르고 잠시 뒤 화면 */
  | { type: "click"; at: number; from: string; role: ClickRole; name: string; to: string; texts: string[] }
  /** 클릭 없이 화면이 바뀜(시스템 뒤로 키, 네이티브 화면, 앱 리다이렉트) */
  | { type: "jump"; at: number; from: string; to: string };

export interface RecordingResult {
  /** 홈에서 시작하는 플로우 스텝. 다시 돌릴 수 없는 구간(jump)에서 끊는다. 마지막 화면 문구로 확인 스텝을 붙인다. */
  steps: FlowStep[];
  /** 화면 지도에 합칠 버튼 결과(화면별) */
  screens: { from: string; buttons: ButtonResult[] }[];
  /** 스텝을 끊은 이유. 끊지 않았으면 null */
  cut: string | null;
}

/** 기록을 스텝으로 바꿀 때 보는 앱 설정 */
export interface RecordingRules {
  homePath: string;
  forbiddenClickNames: readonly string[];
}

/** 누른 뒤 경로가 바뀌었거나 문구가 보였으면 반응한 버튼이다. 아무것도 모르면 지도에 남기지 않는다. */
function buttonOf(event: Extract<RecordEvent, { type: "click" }>): ButtonResult | null {
  const moved = normalizePath(event.from) !== normalizePath(event.to);
  if (!moved && event.texts.length === 0) return null;
  return {
    role: event.role,
    name: event.name,
    status: "reacted",
    message: moved ? `${event.to}로 이동` : "화면 내용 바뀜",
    ...(moved ? { to: event.to } : {}),
    ...(event.texts.length > 0 ? { texts: event.texts } : {}),
  };
}

function screensOf(events: readonly RecordEvent[]): RecordingResult["screens"] {
  const byFrom = new Map<string, ButtonResult[]>();
  for (const event of events) {
    if (event.type !== "click") continue;
    const button = buttonOf(event);
    if (!button) continue;
    const from = normalizePath(event.from);
    byFrom.set(from, [...(byFrom.get(from) ?? []), button]);
  }
  return [...byFrom.entries()].map(([from, buttons]) => ({ from, buttons }));
}

/** 기록 시작 화면은 홈이어야 한다(플로우는 홈에서 시작). 홈으로 돌아오는 jump는 「홈」 스텝으로 이어 간다. */
function stepsOf(events: readonly RecordEvent[], startPath: string, { homePath, forbiddenClickNames }: RecordingRules): { steps: FlowStep[]; cut: string | null; lastTexts: string[] } {
  if (normalizePath(startPath) !== homePath) return { steps: [], cut: `기록을 ${startPath}에서 시작해 홈부터 다시 돌 수 없습니다.`, lastTexts: [] };
  const steps: FlowStep[] = [];
  let lastTexts: string[] = [];
  for (const event of events) {
    if (event.type === "jump") {
      if (normalizePath(event.to) === homePath) {
        steps.push({ type: "home" });
        lastTexts = [];
        continue;
      }
      return { steps, cut: `${event.from}에서 클릭 없이 ${event.to}로 바뀌었습니다.`, lastTexts };
    }
    if (forbiddenClickNames.includes(event.name)) return { steps, cut: `금지 버튼 「${event.name}」을 눌렀습니다.`, lastTexts };
    steps.push({ type: "click", target: { role: event.role, name: event.name } });
    lastTexts = event.texts;
  }
  return { steps, cut: null, lastTexts };
}

export function buildRecording(events: readonly RecordEvent[], startPath: string, rules: RecordingRules): RecordingResult {
  const { steps, cut, lastTexts } = stepsOf(events, startPath, rules);
  const withExpect: FlowStep[] = steps.some((step) => step.type === "click") && lastTexts.length > 0 ? [...steps, { type: "expectText", text: lastTexts[0] }] : steps;
  return { steps: withExpect, screens: screensOf(events), cut };
}

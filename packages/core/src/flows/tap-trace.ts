import type { ScreenDriver } from "../device/driver";

/**
 * 누르기 전후 화면 상태. 글자 내용은 남기지 않고(개인정보) 길이·팝업 수만 본다.
 * 시세처럼 저절로 바뀌는 글자가 있어 길이만으로 「눌렸다」고 판정하지 않는다 — 실패 원인을 볼 때 쓰는 기록이다.
 */
export type ScreenState = { path: string; text: number; dialogs: number };

const stateScript = `(() => ({
  text: (document.body ? document.body.innerText : "").replace(/\\s+/g, " ").trim().length,
  dialogs: document.querySelectorAll('[role="dialog"], [aria-modal="true"]').length,
}))()`;

/** 못 읽으면 null. 기록은 부가라 점검 결과를 바꾸지 않는다 */
export async function readState(driver: ScreenDriver): Promise<ScreenState | null> {
  try {
    const path = await driver.currentPath();
    const read = await driver.evaluate<{ text: number; dialogs: number } | undefined>(stateScript);
    return read ? { path, text: read.text, dialogs: read.dialogs } : null;
  } catch {
    return null;
  }
}

const describe = (state: ScreenState | null) => (state ? `${state.path}(글자 ${state.text}·팝업 ${state.dialogs})` : "못 읽음");

/** 경로·글자 수·팝업 수가 모두 같으면 그대로다 */
export function unchanged(before: ScreenState | null, after: ScreenState | null): boolean {
  return before !== null && after !== null && before.path === after.path && before.text === after.text && before.dialogs === after.dialogs;
}

/** 기록 한 줄: `2단계 「충전하기」 누르기: /my(글자 812·팝업 0) → … · 화면 그대로 · 누른 자리 …` */
export function tapLine(label: string, before: ScreenState | null, after: ScreenState | null, detail: string): string {
  return [`${label}: ${describe(before)} → ${describe(after)}`, ...(unchanged(before, after) ? ["화면 그대로"] : []), ...(detail ? [detail] : [])].join(" · ");
}

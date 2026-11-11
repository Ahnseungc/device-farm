import { sleep as wait } from "../sleep";
import { hasForbiddenWord, listActionsScript, type ActionCandidate } from "../explore/actions";
import type { Issue, IssueKind } from "../explore/probe";
import type { ClickRole, ScreenDriver } from "./driver";
import { samePath } from "./screen-ready";

/** 화면당 누를 버튼·링크 수, 누른 뒤 반응을 기다리는 시간, 도착 화면에서 남길 문구 수 (작성자 판단) */
export const buttonCheckLimits = { maxButtonsPerScreen: 12, settleMs: 1_500, maxTexts: 5 } as const;

/** 버튼 하나를 누른 결과에서 실패로 보는 문제. 레이아웃 문제는 화면 점검·탐색이 본다. */
export const buttonErrorKinds = ["app-error", "crash", "network", "login-redirect"] as const satisfies readonly IssueKind[];

/** skipped: 누를 수 없었다(앞 버튼이 화면 상태를 바꿔 사라짐·화면 복귀 실패). 앱 결함으로 보지 않는다. */
export type ButtonStatus = "reacted" | "dead" | "error" | "skipped";

/**
 * 누르지 않는 버튼·링크. 뒤로가기는 화면을 떠나기만 하고 복귀를 꼬이게 하고,
 * 하단 탭은 어느 화면에나 있어 화면 지도에 같은 길만 늘린다 (작성자 판단).
 */
export function skippedButtonNames(app: Pick<ScreenDriver["app"], "inPageBackNames" | "tabPaths">): string[] {
  return [...app.inPageBackNames, ...Object.keys(app.tabPaths)];
}

export interface ButtonTarget {
  role: ClickRole;
  name: string;
}

export interface ButtonResult extends ButtonTarget {
  status: ButtonStatus;
  /** reacted: 무엇이 바뀌었나. error: 무엇이 났나 */
  message?: string;
  /** reacted로 다른 경로에 갔을 때 그 경로 */
  to?: string;
  /** reacted 뒤 화면의 제목·팝업 문구. 화면 지도에서 「문구 확인」 후보가 된다 */
  texts?: string[];
}

export interface ButtonCheckDeps {
  /** since 이후 문제(앱 오류·크래시·네트워크·로그인 이탈 등) */
  probe: (since: number) => Promise<Issue[]>;
  /** 반응한 버튼 뒤 화면을 다시 연다 */
  restore: () => Promise<void>;
  /** 이 화면 경로. 다시 연 뒤 이 경로가 아니면 남은 버튼은 누르지 않는다 */
  screenPath: string;
  now?: () => number;
  settleMs?: number;
  maxButtons?: number;
}

/** 경로와 화면 내용 요약. 둘 중 하나라도 바뀌면 버튼이 반응한 것이다(이동·팝업·시트·토스트). */
type ScreenFingerprint = { path: string; content: string };

const fingerprintScript = `(() => {
  const text = (document.body ? document.body.innerText : "").replace(/\\s+/g, " ").trim();
  const dialogs = document.querySelectorAll('[role="dialog"], [aria-modal="true"]').length;
  return text.length + "|" + dialogs + "|" + text.slice(0, 200) + "|" + text.slice(-200);
})()`;

async function fingerprint(driver: ScreenDriver): Promise<ScreenFingerprint> {
  return { path: await driver.currentPath(), content: await driver.evaluate<string>(fingerprintScript) };
}

/* screen-texts: 도착 화면을 알아볼 문구. 열린 팝업이 있으면 그 안에서, 없으면 제목에서 고른다. */
export const screenTextsScript = `(() => {
  const dialogs = Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"]'));
  const root = dialogs.at(-1) || document;
  const visible = (el) => { const rect = el.getBoundingClientRect(); return rect.width > 0 && rect.height > 0; };
  const nodes = Array.from(root.querySelectorAll('h1, h2, h3, [role="heading"], header p, [role="dialog"] p')).filter(visible);
  const texts = nodes.map((el) => el.innerText.replace(/\\s+/g, " ").trim()).filter((text) => text.length > 0 && text.length <= 40);
  return [...new Set(texts)].slice(0, ${buttonCheckLimits.maxTexts});
})()`;

function reaction(before: ScreenFingerprint, after: ScreenFingerprint): string | null {
  if (before.path !== after.path) return `${after.path}로 이동`;
  if (before.content !== after.content) return "화면 내용 바뀜";
  return null;
}

/** 보이는·누를 수 있는 버튼과 링크. 금지어(구매·결제·충전 등)는 뺀다. 같은 역할·이름은 한 번. */
export async function listButtons(driver: ScreenDriver, max: number = buttonCheckLimits.maxButtonsPerScreen): Promise<ButtonTarget[]> {
  const candidates = await driver.evaluate<ActionCandidate[]>(listActionsScript);
  const unique = new Map<string, ButtonTarget>();
  const skipped = skippedButtonNames(driver.app);
  for (const { role, name } of candidates) {
    if (role === "input" || hasForbiddenWord(name, driver.app.guard.forbiddenButtonWords) || skipped.includes(name)) continue;
    unique.set(`${role}:${name}`, { role, name });
  }
  return [...unique.values()].slice(0, max);
}

async function pressOne(driver: ScreenDriver, target: ButtonTarget, deps: ButtonCheckDeps): Promise<ButtonResult> {
  const now = deps.now ?? Date.now;
  const before = await fingerprint(driver);
  const since = now();
  try {
    await driver.clickButton(target.name, target.role);
  } catch (error) {
    // 목록을 읽은 뒤 앞 버튼이 화면 상태를 바꿔 사라진 경우다. 앱 결함이 아니다.
    return { ...target, status: "skipped", message: error instanceof Error ? error.message : String(error) };
  }
  await wait(deps.settleMs ?? buttonCheckLimits.settleMs);
  const errors = (await deps.probe(since)).filter((issue) => (buttonErrorKinds as readonly IssueKind[]).includes(issue.kind));
  const after = await fingerprint(driver).catch(() => ({ path: "", content: "" }));
  const changed = reaction(before, after);
  // 문구를 못 읽어도 반응 판정은 그대로 둔다. 지도에 문구만 빠진다.
  const texts = changed ? await driver.evaluate<string[]>(screenTextsScript).catch(() => []) : [];
  if (changed) await deps.restore();
  if (errors.length > 0) return { ...target, status: "error", message: errors.map((issue) => issue.message).join(" · ") };
  if (!changed) return { ...target, status: "dead" };
  return { ...target, status: "reacted", message: changed, texts, ...(before.path !== after.path ? { to: after.path } : {}) };
}

/**
 * 지금 화면의 버튼·링크를 하나씩 실제로 눌러 반응을 본다. 반응했으면 화면을 다시 열고 다음 버튼으로 간다.
 * 쓰기 요청은 호출하는 쪽의 가드가 막는다(탐색 점검과 같은 허용 목록).
 */
export async function checkButtons(driver: ScreenDriver, deps: ButtonCheckDeps): Promise<ButtonResult[]> {
  const results: ButtonResult[] = [];
  const targets = await listButtons(driver, deps.maxButtons);
  for (const [index, target] of targets.entries()) {
    results.push(await pressOne(driver, target, deps));
    const path = await driver.currentPath().catch(() => "");
    if (!samePath(deps.screenPath, path)) {
      const rest = targets.slice(index + 1).map((skipped) => ({ ...skipped, status: "skipped" as const, message: `화면 복귀 실패: ${path}에 머묾` }));
      return [...results, ...rest];
    }
  }
  return results;
}

/** 화면 결과 메시지 한 줄: `버튼 8개 · 반응 없음 2(알림, 공유) · 에러 1(복사)` */
export function summarizeButtons(results: readonly ButtonResult[]): string {
  const named = (status: ButtonStatus) => results.filter((item) => item.status === status).map((item) => item.name);
  const dead = named("dead");
  const errors = named("error");
  const skipped = named("skipped");
  const parts = [`버튼 ${results.length}개`];
  if (dead.length > 0) parts.push(`반응 없음 ${dead.length}(${dead.join(", ")})`);
  if (errors.length > 0) parts.push(`에러 ${errors.length}(${errors.join(", ")})`);
  if (skipped.length > 0) parts.push(`건너뜀 ${skipped.length}`);
  return parts.join(" · ");
}

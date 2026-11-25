import { sleep as wait } from "../sleep";
import { hasForbiddenWord, listActionsScript, type ActionCandidate } from "../explore/actions";
import type { Issue, IssueKind } from "../explore/probe";
import type { ClickRole, ScreenDriver } from "./driver";
import { samePath } from "./screen-ready";

/** 화면당 누를 버튼·링크 수, 누른 뒤 반응을 기다리는 시간, 도착 화면에서 남길 문구 수 (작성자 판단) */
export const buttonCheckLimits = { maxButtonsPerScreen: 12, settleMs: 1_500, maxTexts: 5, maxRecoveries: 2, stillMs: 300 } as const;

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

/** 목록에서 읽은 버튼. selected는 결과에 남기지 않는다 */
type ListedButton = ButtonTarget & { selected?: boolean };

/** 이미 고른 버튼이라 안 바뀐 것. 앱 결함이 아니라 `skipped`다 */
export const alreadySelectedMessage = "이미 선택된 항목이라 바뀌지 않음";

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
  /** 앱을 다시 켜고 이 화면을 연다. 화면 복귀가 실패하면 화면마다 `maxRecoveries`번까지 부른다. 없으면 남은 버튼을 건너뛴다 */
  recover?: () => Promise<void>;
  /** 이 화면 경로. 다시 연 뒤 이 경로가 아니면 남은 버튼은 누르지 않는다 */
  screenPath: string;
  now?: () => number;
  settleMs?: number;
  maxButtons?: number;
  /** 점검을 멈췄는가(QA 제보에 밀림·멈춤). 참이면 남은 버튼은 누르지 않고 `skipped`로 남긴다 */
  stopped?: () => boolean;
}

/** 멈춘 점검에서 누르지 않은 버튼의 메시지 */
export const buttonStoppedMessage = "점검을 멈춰 누르지 않음";

/** 경로와 화면 내용 요약. 둘 중 하나라도 바뀌면 버튼이 반응한 것이다(이동·팝업·시트·토스트). */
type ScreenFingerprint = { path: string; content: string };

/**
 * 버튼·입력칸의 모양 상태(고른 칩의 class, 체크, 입력한 글자 수). 글자는 그대로인데 골라진 것만 바뀌는 버튼이 있다
 *.
 */
const controlsScript = `(() => {
  const parts = [];
  for (const el of document.querySelectorAll('button, [role], input, textarea, select, label')) {
    const aria = ["aria-selected", "aria-pressed", "aria-checked", "aria-expanded", "data-state", "disabled"].map((name) => el.getAttribute(name) || "").join(",");
    parts.push(String(el.getAttribute("class") || "") + aria + (el.checked === true ? "1" : "0") + String(el.value || "").length + ":" + Array.from(el.children).map((child) => child.getAttribute("class") || "").join(","));
  }
  for (const el of document.querySelectorAll('[class*="rounded-full"]')) parts.push(String(el.getAttribute("class")));
  let hash = 0;
  const text = parts.join("|");
  for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) | 0;
  return "controls" + parts.length + ":" + hash;
})()`;

const readControls = (driver: ScreenDriver) => driver.evaluate<string>(controlsScript).catch(() => "");

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
export async function listButtons(driver: ScreenDriver, max: number = buttonCheckLimits.maxButtonsPerScreen): Promise<ListedButton[]> {
  const candidates = await driver.evaluate<ActionCandidate[]>(listActionsScript);
  const unique = new Map<string, ListedButton>();
  const skipped = skippedButtonNames(driver.app);
  for (const { role, name, selected } of candidates) {
    if (role === "input" || hasForbiddenWord(name, driver.app.guard.forbiddenButtonWords) || skipped.includes(name)) continue;
    unique.set(`${role}:${name}`, { role, name, ...(selected ? { selected } : {}) });
  }
  return [...unique.values()].slice(0, max);
}

/** 숫자(시세·수량·등락)를 지운 이름. 「금 24K 코인 6,266,738원 -207,712원(3.21%)」처럼 이름에 시세가 든 버튼을 알아본다 */
export const buttonShape = (name: string) => name.replace(/[+-]?\d[\d,.]*/g, "#");

/**
 * 지금 화면에서 누를 이름. 이름에 든 시세가 목록을 읽은 뒤 바뀌었으면, 숫자만 다른 같은 역할 버튼이 하나일 때 그 이름을 쓴다
 *.
 */
async function currentName(driver: ScreenDriver, target: ButtonTarget): Promise<string> {
  const shape = buttonShape(target.name);
  if (shape === target.name) return target.name;
  const listed = (await listButtons(driver, Infinity).catch(() => [])).filter((item) => item.role === target.role);
  if (listed.some((item) => item.name === target.name)) return target.name;
  const same = listed.filter((item) => buttonShape(item.name) === shape);
  return same.length === 1 ? same[0].name : target.name;
}

/** 누른 결과와, 반응 뒤 화면을 다시 열지 못했으면 그 이유 */
type Pressed = { result: ButtonResult; restoreError?: string };

async function pressOne(driver: ScreenDriver, target: ListedButton, deps: ButtonCheckDeps): Promise<Pressed> {
  const result = await pressOnly(driver, target, deps);
  if (!result.restore) return { result: result.result };
  // 화면을 다시 열다 실패해도(앞 버튼이 띄운 전면 광고가 홈 탭을 덮음 등) 점검 전체를 멈추지 않는다.
  try {
    await deps.restore();
    return { result: result.result };
  } catch (error) {
    return { result: result.result, restoreError: error instanceof Error ? error.message.split("\n")[0] : String(error) };
  }
}

async function pressOnly(driver: ScreenDriver, { selected, ...target }: ListedButton, deps: ButtonCheckDeps): Promise<{ result: ButtonResult; restore: boolean }> {
  const now = deps.now ?? Date.now;
  const settleMs = deps.settleMs ?? buttonCheckLimits.settleMs;
  const before = await fingerprint(driver);
  // 혼자 움직이는 화면(배너 점 등)이면 모양 상태로는 반응을 가릴 수 없다
  const controls = await readControls(driver);
  await wait(Math.min(settleMs, buttonCheckLimits.stillMs));
  const still = (await readControls(driver)) === controls;
  const since = now();
  try {
    await driver.clickButton(await currentName(driver, target), target.role);
  } catch (error) {
    // 목록을 읽은 뒤 앞 버튼이 화면 상태를 바꿔 사라진 경우다. 앱 결함이 아니다.
    return { result: { ...target, status: "skipped", message: error instanceof Error ? error.message : String(error) }, restore: false };
  }
  await wait(settleMs);
  const errors = (await deps.probe(since)).filter((issue) => (buttonErrorKinds as readonly IssueKind[]).includes(issue.kind));
  const after = await fingerprint(driver).catch(() => ({ path: "", content: "" }));
  const changed = reaction(before, after);
  // 문구를 못 읽어도 반응 판정은 그대로 둔다. 지도에 문구만 빠진다.
  const texts = changed ? await driver.evaluate<string[]>(screenTextsScript).catch(() => []) : [];
  const restore = Boolean(changed);
  if (errors.length > 0) return { result: { ...target, status: "error", message: errors.map((issue) => issue.message).join(" · ") }, restore };
  // 고른 것만 바뀌었으면 화면은 그대로라 다시 열지 않는다
  if (!changed && still && (await readControls(driver)) !== controls) return { result: { ...target, status: "reacted", message: "선택 상태 바뀜", texts: [] }, restore };
  if (!changed && selected) return { result: { ...target, status: "skipped", message: alreadySelectedMessage }, restore };
  if (!changed) return { result: { ...target, status: "dead" }, restore };
  return { result: { ...target, status: "reacted", message: changed, texts, ...(before.path !== after.path ? { to: after.path } : {}) }, restore };
}

/**
 * 지금 화면의 버튼·링크를 하나씩 실제로 눌러 반응을 본다. 반응했으면 화면을 다시 열고 다음 버튼으로 간다.
 * 쓰기 요청은 호출하는 쪽의 가드가 막는다(탐색 점검과 같은 허용 목록).
 */
export async function checkButtons(driver: ScreenDriver, deps: ButtonCheckDeps): Promise<ButtonResult[]> {
  const results: ButtonResult[] = [];
  let recoveries = 0;
  const targets = await listButtons(driver, deps.maxButtons);
  for (const [index, target] of targets.entries()) {
    // 버튼 하나가 수십 초라 화면 하나를 다 누르면 몇 분이 걸린다. 멈춤을 버튼마다 봐야 급한 QA 제보가 바로 돈다
    if (deps.stopped?.()) return [...results, ...targets.slice(index).map(({ role, name }) => ({ role, name, status: "skipped" as const, message: buttonStoppedMessage }))];
    const pressed = await pressOne(driver, target, deps);
    results.push(pressed.result);
    const rest = targets.slice(index + 1);
    if (rest.length === 0) return results;
    let stuck = pressed.restoreError ?? (await elsewhere(driver, deps.screenPath));
    // 앱을 다시 켜면 대부분 돌아온다. 안 하면 버튼 하나 때문에 그 화면의 남은 버튼을 다 건너뛴다
    while (stuck && deps.recover && recoveries < buttonCheckLimits.maxRecoveries && !deps.stopped?.()) {
      recoveries += 1;
      stuck = await deps.recover().then(
        () => elsewhere(driver, deps.screenPath),
        (error: unknown) => (error instanceof Error ? error.message.split("\n")[0] : String(error)),
      );
    }
    if (stuck) return [...results, ...rest.map(({ role, name }) => ({ role, name, status: "skipped" as const, message: `화면 복귀 실패: ${stuck}` }))];
  }
  return results;
}

/** 이 화면이 아니면 어디에 머물렀는지, 맞으면 undefined */
async function elsewhere(driver: ScreenDriver, screenPath: string): Promise<string | undefined> {
  const path = await driver.currentPath().catch(() => "");
  return samePath(screenPath, path) ? undefined : `${path}에 머묾`;
}

/**
 * 화면 결과 메시지 끝에 붙는 에러 원인 머리말. 실패 무시 키가 이 뒤(원인)만 본다(`failureIgnoreKey`).
 * 원인이 없으면 슬랙만 보고 판단할 수 없었다.
 */
export const errorCauseLabel = "에러 원인: ";

/** 원인 하나의 최대 글자 수. 크래시·콘솔 문구가 길어 메시지를 덮지 않게 (작성자 판단) */
const maxCauseLength = 100;

/** 버튼 하나의 첫 문제(`GET 404 https://…/v1/api/…`). 여러 개면 ` · `로 이어져 있다 */
function causeOf(message: string | undefined): string {
  const first = (message ?? "").split(" · ")[0].trim();
  return first.length > maxCauseLength ? `${first.slice(0, maxCauseLength)}…` : first;
}

/** 화면 결과 메시지 한 줄: `버튼 8개 · 반응 없음 2(알림, 공유) · 에러 1(복사) · 에러 원인: POST 500 https://…/copy` */
export function summarizeButtons(results: readonly ButtonResult[]): string {
  const named = (status: ButtonStatus) => results.filter((item) => item.status === status).map((item) => item.name);
  const dead = named("dead");
  const errors = named("error");
  const skipped = named("skipped");
  const causes = [...new Set(results.filter((item) => item.status === "error").map((item) => causeOf(item.message)).filter(Boolean))];
  const parts = [`버튼 ${results.length}개`];
  if (dead.length > 0) parts.push(`반응 없음 ${dead.length}(${dead.join(", ")})`);
  if (errors.length > 0) parts.push(`에러 ${errors.length}(${errors.join(", ")})`);
  if (skipped.length > 0) parts.push(`건너뜀 ${skipped.length}`);
  // 원인은 맨 끝에 둔다. 무시 키가 머리말 뒤를 통째로 쓴다
  if (causes.length > 0) parts.push(`${errorCauseLabel}${causes.join(" / ")}`);
  return parts.join(" · ");
}

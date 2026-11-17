import { isTabName, type AppNavigation } from "../config/app-config";

/**
 * 카오스 탐색의 행동 고르기(docs/design-chaos.md). 행동마다 점수를 매기고 점수에 비례해 하나를 뽑는다.
 * 무작위는 시드로 정해 같은 시드·같은 앱 상태면 같은 순서가 나온다. 판정·실행은 engine이 한다.
 */

export type ChaosKind = "press" | "fill" | "back" | "tab" | "doubleTap" | "backDuringLoad" | "background" | "otherApp" | "restart" | "homeReset";

/**
 * 종류별 기본 가중치 (작성자 판단). 네트워크 끊김은 아직 없다.
 * 홈 리셋·재시작·백그라운드를 설계 문서 표의 절반 아래로 낮췄다. 19회 1,748스텝 중 535번이 뒤로·닫기·홈·재시작이라 홈에서 4단계 넘게 못 갔다(2026-11-16).
 * 입력칸 채우기(fill)는 폼 다음 단계로 가는 유일한 길이라 누르기와 같게 둔다.
 */
export const baseWeights = {
  press: 1.0,
  fill: 1.0,
  back: 0.3,
  tab: 0.2,
  doubleTap: 0.15,
  backDuringLoad: 0.15,
  background: 0.05,
  /** 다른 앱(설정)을 앞에 띄웠다가 돌아오기. 외부 앱 갔다 오면 흰 화면이 남는지 본다(2026-11-17 요청) */
  otherApp: 0.05,
  restart: 0.02,
  homeReset: 0.02,
} as const satisfies Record<ChaosKind, number>;

/** 상황 배수 (작성자 판단) */
/** samePath: 눌러도 경로가 안 바뀐 누르기(차트 기간 일·월·1년 등). 45%의 스텝이 같은 화면에 머물렀다(2026-11-16) */
export const multipliers = { newState: 2, nearError: 3, dead: 0.2, samePath: 0.3 } as const;
/** 반응 없음이 이 횟수 이상이면 dead 배수를 곱한다 */
export const deadAfter = 2;
/**
 * 누르기 후보 전체 가중치 상한. 버튼이 n개면 하나당 min(1, 상한/n) (작성자 판단).
 * 상한이 없으면 버튼이 많은 화면(키패드·뉴스 목록)에서 누르기만 나오고 카오스 행동이 거의 안 나왔다.
 */
export const pressMassCap = 3;
/**
 * 같은 화면에 이만큼 머물 때마다 나가는 행동(뒤로·탭·홈 리셋)은 기본의 1배씩 더하고, 누르기는 그만큼 나눈다 (작성자 판단).
 * 3스텝으로는 긴 입력 폼 화면에서 20스텝 넘게 머물렀다.
 */
export const stayStepsPerBoost = 2;
/** 링크는 대부분 다른 화면으로 간다. 깊이 들어가게 버튼보다 조금 더 고른다 (작성자 판단) */
export const linkBonus = 1.5;
/** 이번 실행에서 아직 안 간 경로를 가리키는 링크(href로 안다) (작성자 판단) */
export const frontierBonus = 3;
/** 지금 화면보다 경로 단계가 깊은 곳으로 가는 링크. 얕은 화면(약관·FAQ)만 넓게 도는 회차가 있었다 (작성자 판단) */
export const deeperBonus = 1.5;

const pathDepth = (path: string) => path.split("/").filter(Boolean).length;
const leaveKinds: readonly ChaosKind[] = ["back", "tab", "homeReset"];
/** 비밀번호·PIN 화면은 누르지 않고 나가기만 한다. 키패드 숫자에 갇히고, 계정 비밀번호를 건드릴 수 있다. */
/** 기본값은 `AppConfig.guard.noPressPathPattern`과 같다 */
export function isNoPressPath(path: string, pattern: RegExp = /password|\/pin(\/|$)/i): boolean {
  return pattern.test(path);
}

export interface ChaosAction {
  kind: ChaosKind;
  /** fill의 넣을 값(name은 입력칸 이름) */
  value?: string;
  /** 링크면 도착 경로(href) */
  to?: string;
  /** press·doubleTap의 대상. backDuringLoad·tab은 실행할 때 무작위로 고른다 */
  role?: "button" | "link";
  name?: string;
}

export interface ActionStats {
  tries: number;
  /** 처음 보는 상태로 간 적이 있다 */
  openedNew: boolean;
  /** 이 행동 뒤에 오류가 난 횟수 */
  errors: number;
  /** 누르고 아무것도 안 바뀐 횟수 */
  dead: number;
  /** 누르고 화면 내용은 바뀌었지만 경로는 그대로인 횟수 */
  stayed?: number;
}

export interface ScoredAction {
  action: ChaosAction;
  score: number;
  probability: number;
}

export const actionKey = (action: ChaosAction) => [action.kind, action.role ?? "", action.name ?? ""].join(":");

/** 광고·디버그 칩·외부 쇼핑 링크. 무작위 클릭이 무효 트래픽이 되거나 앱 밖으로 나간다. 패턴은 `AppConfig.guard.avoidedNamePattern` */
export function isAvoidedName(name: string, pattern: RegExp): boolean {
  return pattern.test(name);
}

export interface ScreenChoices {
  path: string;
  /** 탭·뒤로 버튼·누르지 않는 경로를 아는 앱 설정 */
  nav: Pick<AppNavigation, "tabPaths" | "inPageBackNames"> & Partial<Pick<AppNavigation, "homeTabName" | "homeTabLabels">> & { noPressPathPattern?: RegExp };
  /** 금지어·광고를 이미 뺀 누를 수 있는 요소. 링크는 도착 경로(to)를 안다 */
  targets: readonly { role: "button" | "link"; name: string; to?: string }[];
  /** 직전에 누른 요소(연타 대상) */
  lastPressed?: { role: "button" | "link"; name: string };
  /** 값을 넣을 수 있는 입력칸. numeric이면 숫자칸 */
  inputs?: readonly { name: string; numeric: boolean }[];
}

/** 봇이 입력칸에 넣는 테스트 값. 쓰기 요청은 가드가 막아 저장되지 않는다 */
export const fillValues = { numeric: "1", text: "디바이스팜" } as const;

/**
 * 탭 루트 화면에서 시스템 뒤로 키는 탭 이력을 바꾸거나 앱을 닫는다(홈에서 뒤로 → 다른 탭, 다음 회차 홈 이동 실패).
 * 화면 안 뒤로 버튼이 있거나 탭 루트가 아닐 때만 뒤로를 후보로 둔다.
 */
function canGoBack(screen: ScreenChoices): boolean {
  if (screen.targets.some((target) => screen.nav.inPageBackNames.includes(target.name))) return true;
  return !Object.values(screen.nav.tabPaths).includes(screen.path);
}

/** 점수를 매길 때 보는 화면 맥락 */
export interface ScoreContext {
  /** 이 화면의 누르기 후보 수 */
  pressCount: number;
  /** 같은 경로에 연속으로 머문 스텝 수(막 도착하면 0) */
  stay: number;
  /** 이번 실행에서 가 본 경로인가 */
  visited?: (path: string) => boolean;
  /** 지금 화면 경로(더 깊은 링크를 가리는 데 쓴다) */
  path?: string;
}

/**
 * 지금 화면에서 고를 수 있는 행동. 카오스 행동과 탭 이동은 종류마다 하나씩만 둔다(대상 수만큼 늘면 비중이 커진다).
 * 탭을 탭마다 후보로 두면 합이 1.0이 돼 네 스텝에 한 번꼴로 다른 탭으로 튀어 깊이가 리셋됐다.
 */
export function chaosCandidates(screen: ScreenChoices): ChaosAction[] {
  const noPress = isNoPressPath(screen.path, screen.nav.noPressPathPattern);
  const press = noPress ? [] : screen.targets.filter((target) => !isTabName(screen.nav, target.name));
  const tabs = screen.targets.filter((target) => target.role === "link" && isTabName(screen.nav, target.name));
  const last = screen.lastPressed;
  const lastVisible = last && press.some((target) => target.role === last.role && target.name === last.name);
  return [
    ...press.map((target): ChaosAction => ({ kind: "press", ...target })),
    ...(noPress ? [] : (screen.inputs ?? []).map((input): ChaosAction => ({ kind: "fill", name: input.name, value: input.numeric ? fillValues.numeric : fillValues.text }))),
    ...(canGoBack(screen) ? [{ kind: "back" } as ChaosAction] : []),
    ...(tabs.length > 0 ? [{ kind: "tab" } as ChaosAction] : []),
    ...(lastVisible ? [{ kind: "doubleTap", ...last } as ChaosAction] : []),
    // 뒤로 버튼만 남은 화면에서 고르면 누를 대상이 없어 실패했다(2026-11-11 시드 11201)
    ...(press.some((target) => !screen.nav.inPageBackNames.includes(target.name)) ? [{ kind: "backDuringLoad" } as ChaosAction] : []),
    { kind: "background" },
    { kind: "otherApp" },
    { kind: "restart" },
    { kind: "homeReset" },
  ];
}

function baseScore(action: ChaosAction, context: ScoreContext): number {
  const stayFactor = 1 + context.stay / stayStepsPerBoost;
  if (action.kind === "press") {
    const share = baseWeights.press * Math.min(1, pressMassCap / Math.max(1, context.pressCount));
    const frontier = action.to && context.visited && !context.visited(action.to) ? frontierBonus : 1;
    const deeper = action.to && context.path !== undefined && pathDepth(action.to) > pathDepth(context.path) ? deeperBonus : 1;
    return (share * (action.role === "link" ? linkBonus : 1) * frontier * deeper) / stayFactor;
  }
  return leaveKinds.includes(action.kind) ? baseWeights[action.kind] * stayFactor : baseWeights[action.kind];
}

export function scoreAction(action: ChaosAction, stats: ActionStats | undefined, context: ScoreContext = { pressCount: 1, stay: 0 }): number {
  const base = baseScore(action, context);
  if (!stats) return base;
  return (
    (base / (1 + stats.tries)) *
    (stats.openedNew ? multipliers.newState : 1) *
    (stats.errors > 0 ? multipliers.nearError : 1) *
    (stats.dead >= deadAfter ? multipliers.dead : 1) *
    ((stats.stayed ?? 0) > 0 && !stats.openedNew ? multipliers.samePath : 1)
  );
}

/** 행동 기록 키. 화면마다 따로 센다(「닫기」를 한 화면에서 눌렀다고 다른 화면의 「닫기」가 덜 뽑히면 안 된다). */
export const statsKey = (path: string, action: ChaosAction) => `${path}|${actionKey(action)}`;

export function scoreAll(
  candidates: readonly ChaosAction[],
  statsOf: (key: string) => ActionStats | undefined,
  path: string,
  stay = 0,
  visited?: (path: string) => boolean,
): ScoredAction[] {
  const context: ScoreContext = { pressCount: candidates.filter((action) => action.kind === "press").length, stay, visited, path };
  const scored = candidates.map((action) => ({ action, score: scoreAction(action, statsOf(statsKey(path, action)), context) }));
  const total = scored.reduce((sum, item) => sum + item.score, 0);
  return scored.map((item) => ({ ...item, probability: total > 0 ? item.score / total : 0 }));
}

/** 깊은 시작 화면 후보로 칠 최소 경로 단계(/a/b부터) (작성자 판단) */
export const deepStartMinDepth = 2;

/**
 * 회차를 시작할 깊은 화면 후보: 지도·지난 봇 기록에서 본 경로 중 2단계 이상. 비밀번호 화면·다른 앱·읽기 실패·광고 주소는 뺀다.
 * 홈에서만 출발하면 회차 30~50스텝 안에 4단계까지만 닿았다(2026-11-16).
 */
export function deepStartPool(paths: Iterable<string>, noPressPathPattern?: RegExp): string[] {
  const pool = new Set<string>();
  for (const raw of paths) {
    const path = raw.split(/[?#]/)[0];
    if (!path.startsWith("/") || /["<>%]/.test(path) || isNoPressPath(path, noPressPathPattern) || path.startsWith("/dev/")) continue;
    if (pathDepth(path) >= deepStartMinDepth) pool.add(path);
  }
  return [...pool].sort();
}

/** 이번 실행에서 아직 안 간 후보 하나. 다 갔으면 아무거나, 후보가 없으면 undefined */
export function pickStartPath(pool: readonly string[], visited: (path: string) => boolean, random: () => number): string | undefined {
  const fresh = pool.filter((path) => !visited(path));
  const from = fresh.length > 0 ? fresh : pool;
  return from.length > 0 ? from[Math.floor(random() * from.length)] : undefined;
}

/** 시드 고정 난수(mulberry32). 0 이상 1 미만. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 점수에 비례해 하나를 뽑는다. */
export function pickWeighted<T extends { score: number }>(items: readonly T[], random: () => number): T {
  const total = items.reduce((sum, item) => sum + item.score, 0);
  let point = random() * total;
  for (const item of items) {
    point -= item.score;
    if (point < 0) return item;
  }
  return items[items.length - 1];
}

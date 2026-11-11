import type { AppNavigation } from "../config/app-config";

/**
 * 카오스 탐색의 행동 고르기(docs/design-chaos.md). 행동마다 점수를 매기고 점수에 비례해 하나를 뽑는다.
 * 무작위는 시드로 정해 같은 시드·같은 앱 상태면 같은 순서가 나온다. 판정·실행은 engine이 한다.
 */

export type ChaosKind = "press" | "back" | "tab" | "doubleTap" | "backDuringLoad" | "background" | "restart" | "homeReset";

/** 종류별 기본 가중치 (작성자 판단, docs/design-chaos.md 표와 같다). 입력·네트워크 끊김은 아직 없다. */
export const baseWeights = {
  press: 1.0,
  back: 0.3,
  tab: 0.2,
  doubleTap: 0.15,
  backDuringLoad: 0.15,
  background: 0.1,
  restart: 0.05,
  homeReset: 0.05,
} as const satisfies Record<ChaosKind, number>;

/** 상황 배수 (작성자 판단) */
export const multipliers = { newState: 2, nearError: 3, dead: 0.2 } as const;
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
  nav: Pick<AppNavigation, "tabPaths" | "inPageBackNames"> & { noPressPathPattern?: RegExp };
  /** 금지어·광고를 이미 뺀 누를 수 있는 요소. 링크는 도착 경로(to)를 안다 */
  targets: readonly { role: "button" | "link"; name: string; to?: string }[];
  /** 직전에 누른 요소(연타 대상) */
  lastPressed?: { role: "button" | "link"; name: string };
}

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
  const tabNames = Object.keys(screen.nav.tabPaths);
  const press = isNoPressPath(screen.path, screen.nav.noPressPathPattern) ? [] : screen.targets.filter((target) => !tabNames.includes(target.name));
  const tabs = screen.targets.filter((target) => target.role === "link" && tabNames.includes(target.name));
  const last = screen.lastPressed;
  const lastVisible = last && press.some((target) => target.role === last.role && target.name === last.name);
  return [
    ...press.map((target): ChaosAction => ({ kind: "press", ...target })),
    ...(canGoBack(screen) ? [{ kind: "back" } as ChaosAction] : []),
    ...(tabs.length > 0 ? [{ kind: "tab" } as ChaosAction] : []),
    ...(lastVisible ? [{ kind: "doubleTap", ...last } as ChaosAction] : []),
    ...(press.length > 0 ? [{ kind: "backDuringLoad" } as ChaosAction] : []),
    { kind: "background" },
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
    (stats.dead >= deadAfter ? multipliers.dead : 1)
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

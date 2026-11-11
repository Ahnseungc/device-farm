import { sleep } from "../sleep";
import { buttonCheckLimits, screenTextsScript } from "../device/button-check";
import { isLoginPath, type ClickRole, type ScreenDriver } from "../device/driver";
import { hasForbiddenWord, listActionsScript } from "../explore/actions";
import type { RecordEvent } from "../record/recording";

/**
 * 에이전트(Claude Code 등)가 기기를 탐색할 때 쓰는 손발: 보기·이름으로 누르기·홈·이상 기록.
 * 정해진 플로우가 못 잡는 엣지 케이스를 찾는 용도다. 누른 것은 디바이스팜 스텝과 같은 이름 규칙이라
 * 기록(RecordEvent)이 곧 플로우·화면 지도가 된다. 판정은 하지 않는다. 남긴 이상은 사람이 확인할 후보다.
 * 금지 버튼은 목록에서 빼고 눌러도 거절한다. 쓰기 요청 차단(가드)은 세션을 여는 쪽이 건다.
 */

/** 한 세션에서 누르기·홈 이동을 합친 기본 최대 횟수 (작성자 판단) */
export const defaultMaxActions = 40;
/** 화면에 보여 줄 버튼 수 상한. 목록이 길면 앞에서 자른다 (작성자 판단) */
const maxListedActions = 40;

export interface AgentFinding {
  path: string;
  description: string;
  screenshot?: Buffer;
}

export interface ScreenView {
  path: string;
  /** 제목·팝업 문구 */
  texts: string[];
  /** 로그인 튕김·앱 오류·막은 쓰기 요청 */
  flags: string[];
  actions: { role: ClickRole; name: string }[];
  remainingActions: number;
}

export interface DeviceSession {
  look: () => Promise<ScreenView>;
  press: (role: ClickRole, name: string) => Promise<ScreenView>;
  goHome: () => Promise<ScreenView>;
  reportIssue: (description: string) => Promise<void>;
  events: RecordEvent[];
  findings: AgentFinding[];
  actions: () => number;
}

export interface DeviceSessionOptions {
  maxActions?: number;
  /** 지난 보기 이후 막은 쓰기 요청(가드). 화면 보기 결과에 같이 보여 준다. */
  takeBlocked?: () => string[];
  now?: () => number;
}

type Candidate = { role: ClickRole | "input"; name: string };

export function createDeviceSession(driver: ScreenDriver, options: DeviceSessionOptions = {}): DeviceSession {
  const maxActions = options.maxActions ?? defaultMaxActions;
  const now = options.now ?? Date.now;
  const events: RecordEvent[] = [];
  const findings: AgentFinding[] = [];
  let actions = 0;
  const { homePath, loginPaths, appErrorText, guard } = driver.app;
  const forbidden = (name: string) => hasForbiddenWord(name, guard.forbiddenButtonWords);
  let lastPath = homePath;
  let lastActions: ScreenView["actions"] = [];

  const look = async (): Promise<ScreenView> => {
    const path = await driver.currentPath();
    const all = await driver.evaluate<Candidate[]>(listActionsScript).catch(() => []);
    const unique = new Map<string, ScreenView["actions"][number]>();
    for (const item of all) if (item.role !== "input" && !forbidden(item.name)) unique.set(`${item.role}:${item.name}`, { role: item.role, name: item.name });
    const texts = await driver.evaluate<string[]>(screenTextsScript).catch(() => []);
    const blocked = options.takeBlocked?.() ?? [];
    const flags = [
      isLoginPath(path, loginPaths) ? "로그인 화면으로 튕김" : null,
      (await driver.hasText(appErrorText).catch(() => false)) ? `앱 오류 표시(${appErrorText})` : null,
      blocked.length > 0 ? `막은 쓰기 요청: ${blocked.join(", ")}` : null,
    ].filter((flag): flag is string => flag !== null);
    lastPath = path;
    lastActions = [...unique.values()].slice(0, maxListedActions);
    return { path, texts, flags, actions: lastActions, remainingActions: Math.max(0, maxActions - actions) };
  };

  const spend = () => {
    if (actions >= maxActions) throw new Error("누를 수 있는 횟수를 다 썼습니다. 탐색을 끝내세요.");
    actions += 1;
  };

  return {
    events,
    findings,
    actions: () => actions,
    look,
    press: async (role, name) => {
      if (forbidden(name)) throw new Error(`「${name}」은 누를 수 없는 버튼입니다.`);
      if (!lastActions.some((item) => item.role === role && item.name === name)) {
        throw new Error(`「${name}」(${role})은 마지막 보기 목록에 없습니다. 화면을 다시 보세요.`);
      }
      spend();
      const from = lastPath;
      await driver.clickButton(name, role);
      await sleep(buttonCheckLimits.settleMs);
      const view = await look();
      events.push({ type: "click", at: now(), from, role, name, to: view.path, texts: view.texts });
      return view;
    },
    goHome: async () => {
      if (!driver.goHome) throw new Error("이 기기는 홈으로 갈 수 없습니다.");
      spend();
      const from = lastPath;
      await driver.goHome();
      const view = await look();
      events.push({ type: "jump", at: now(), from, to: view.path });
      return view;
    },
    reportIssue: async (description) => {
      const screenshot = await driver.screenshot().catch(() => undefined);
      findings.push({ path: lastPath, description, screenshot });
    },
  };
}

import type { ClickMatch, ClickRole, ScreenDriver } from "@device-farm/core/device/driver";
import { isResultPopup, popupCloseSteps, popupHasButton, popupScript, resultPopupMessage, type PopupClose, type PopupInfo } from "@device-farm/core/device/popup";
import { sleep } from "@device-farm/core/sleep";

/** 화면을 연 뒤 늦게 올라오는 팝업(시트 애니메이션)을 한 번 더 기다리는 시간 (작성자 판단) */
export const popupAppearMs = 800;
/** 닫기를 누른 뒤 팝업이 사라지길 기다리는 시간 (작성자 판단) */
export const popupCloseSettleMs = 800;
/** 팝업이 겹쳐 뜰 때 한 번에 닫아 보는 최대 개수 (작성자 판단) */
export const maxPopupsInRow = 3;

/** 만난 팝업 하나. 닫기 전에 찍은 화면과 닫은 방법(못 닫았으면 null) */
export interface PopupEvent {
  path: string;
  info: PopupInfo;
  screenshot: Buffer | null;
  closedBy: PopupClose | null;
}

export interface PopupGuardDeps {
  onPopup: (event: PopupEvent) => Promise<void>;
  log: (message: string) => void;
  wait?: (ms: number) => Promise<void>;
}

/** 팝업을 닫은 결과. pressed면 닫기가 없어 팝업 버튼을 눌렀다(다른 화면으로 갔을 수 있다) */
type Handled = "none" | "closed" | "pressed" | "stuck";

/**
 * 누를 버튼이 화면에 보이고 그 가운데 맨 위가 그 버튼인가. 풀팝업은 「충전 취소하기」가 팝업 요소 밖 아래 고정 영역에 있어
 * 팝업 안 버튼으로 안 잡혔다. 그래서 닫으려다 「닫지 못함」 실패를 남겼다. 누를 수 있으면 팝업을 그대로 둔다.
 */
export function targetReachableScript(name: string, match: ClickMatch = "exact"): string {
  return `(() => {
    const squash = (s) => String(s || "").replace(/\\s+/g, " ").trim();
    const want = squash(${JSON.stringify(name)});
    const prefix = ${JSON.stringify(match)} === "prefix";
    const items = Array.from(document.querySelectorAll('button, [role="button"], a[href], [role="link"], [role="tab"]')).filter((el) => {
      const label = squash(el.getAttribute("aria-label") || el.innerText);
      return prefix ? label.startsWith(want) : label === want;
    });
    return items.some((el) => {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return false;
      const x = r.x + r.width / 2;
      const y = r.y + r.height / 2;
      if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return false;
      const hit = document.elementFromPoint(x, y);
      return Boolean(hit) && (hit === el || el.contains(hit));
    });
  })()`;
}

/** 가려져서·도착 못 해서 실패한 누르기. 팝업 때문일 수 있다 */
const blockedPattern = /가려져|가지 않았습니다/;

/**
 * 드라이버를 감싸 팝업을 점검 항목으로 남기고 닫는다. 화면을 연 뒤(navigate·goHome)와 누르기 전에 본다.
 * 누를 버튼이 팝업 안에 있으면(플로우가 일부러 연 팝업) 닫지 않는다.
 */
export function withPopupGuard(driver: ScreenDriver, deps: PopupGuardDeps): ScreenDriver {
  const wait = deps.wait ?? sleep;

  const detect = async (): Promise<PopupInfo | null> => driver.evaluate<PopupInfo | null>(popupScript).catch(() => null);
  const reachable = async (name: string, match?: ClickMatch) => (await driver.evaluate<unknown>(targetReachableScript(name, match)).catch(() => false)) === true;

  async function closeWith(step: PopupClose): Promise<void> {
    if (step.kind === "dim") {
      if (!driver.tapAt) throw new Error("이 기기는 딤을 누를 수 없습니다.");
      const info = await detect();
      if (!info?.dim) return;
      await driver.tapAt(info.dim.x, info.dim.y);
      return;
    }
    await driver.clickButton(step.name, "button");
  }

  /** 열린 팝업을 하나씩 남기고 닫는다 */
  async function handle(first: PopupInfo | null): Promise<Handled> {
    let result: Handled = "none";
    let info = first;
    for (let count = 0; info && count < maxPopupsInRow; count += 1) {
      const screenshot = await driver.screenshot().catch(() => null);
      const path = await driver.currentPath().catch(() => "");
      let closedBy: PopupClose | null = null;
      for (const step of popupCloseSteps(info, Boolean(driver.tapAt), driver.app.popups.extraCloseNames)) {
        try {
          await closeWith(step);
        } catch (error) {
          deps.log(`팝업 「${info.title}」 ${step.kind === "dim" ? "딤" : `「${step.name}」`} 누르기 실패: ${error instanceof Error ? error.message : String(error)}`);
          continue;
        }
        await wait(popupCloseSettleMs);
        const after = await detect();
        if (!after || after.title !== info.title) {
          closedBy = step;
          break;
        }
      }
      await deps.onPopup({ path, info, screenshot, closedBy });
      if (!closedBy) return "stuck";
      if (closedBy.kind === "press") return "pressed";
      result = "closed";
      info = await detect();
    }
    return result;
  }

  /** 화면을 막 열었을 때: 바로 없으면 조금 기다렸다 한 번 더 본다 */
  async function handleAfterOpen(): Promise<Handled> {
    let info = await detect();
    if (!info) {
      await wait(popupAppearMs);
      info = await detect();
    }
    return handle(info);
  }

  /**
   * 화면 열기(navigate·goHome). 그 안에서 누르기가 팝업에 막혀 실패할 수 있다(goHome이 하단 홈 탭을 누르다 딤에 막힘). 그때 팝업을 남기고 닫은 뒤 한 번 더 연다.
   * 열고 나서 뜬 팝업도 닫는다. 팝업 버튼을 눌러 다른 화면으로 갔으면 다시 연다.
   */
  async function open(work: () => Promise<void>): Promise<void> {
    // 이미 떠 있는 팝업을 먼저 닫는다. 딤 위 탭은 팝업만 닫고 탭을 누르지 않아, 홈 가기가 「/my 화면이 그려지지 않았습니다」로 실패했다
    // 못 닫았으면 앱을 다시 켜서 치운다. 그대로 두면 뒤 화면이 전부 같은 팝업에 막힌다.
    // 다시 켤 수 없는 드라이버면 열기를 해 본다(스택을 닫으면 팝업도 사라질 수 있다). 그래도 막히면 아래에서 원래 오류로 실패한다
    const already = await detect();
    if (already && (await handle(already)) === "stuck" && driver.relaunch) await driver.relaunch();
    try {
      await work();
    } catch (error) {
      const blocking = await detect();
      if (!blocking || (await handle(blocking)) === "stuck") throw error;
      await work();
    }
    if ((await handleAfterOpen()) === "pressed") {
      await work();
      await handle(await detect());
    }
  }

  return {
    ...driver,
    expectText: async (text: string, timeoutMs: number) => {
      try {
        await driver.expectText(text, timeoutMs);
      } catch (error) {
        const during = await detect();
        if (during && isResultPopup(during, driver.app.popups.resultTitles)) throw new Error(resultPopupMessage(during.title));
        throw error;
      }
    },
    navigate: (path) => open(() => driver.navigate(path)),
    ...(driver.goHome ? { goHome: () => open(() => driver.goHome!()) } : {}),
    clickButton: async (name: string, role?: ClickRole, match?: ClickMatch) => {
      const before = await detect();
      // 시간 초과 같은 결과 팝업은 닫지 않고 그 자리에서 멈춘다(누를 버튼이 그 팝업 안이면 플로우가 일부러 누르는 것)
      if (before && isResultPopup(before, driver.app.popups.resultTitles) && !popupHasButton(before, name, match)) throw new Error(resultPopupMessage(before.title));
      if (before && !popupHasButton(before, name, match) && !(await reachable(name, match))) await handle(before);
      try {
        await driver.clickButton(name, role, match);
      } catch (error) {
        const during = await detect();
        if (during && isResultPopup(during, driver.app.popups.resultTitles) && !popupHasButton(during, name, match)) throw new Error(resultPopupMessage(during.title));
        if (!blockedPattern.test(error instanceof Error ? error.message : String(error))) throw error;
        const late = await detect();
        if (!late || popupHasButton(late, name, match) || (await handle(late)) === "stuck") throw error;
        await driver.clickButton(name, role, match);
      }
    },
  };
}

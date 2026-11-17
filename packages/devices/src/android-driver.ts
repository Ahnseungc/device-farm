import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as wait } from "node:timers/promises";

import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

import type { AppConfig } from "@device-farm/core/config/app-config";
import { deepLinkUrl } from "@device-farm/core/device/deep-link";
import { clickLabels, homeAttempts, type ClickMatch, type ClickRole, type ScreenDriver } from "@device-farm/core/device/driver";
import { markStaleScript, samePath, staleMarkKey } from "@device-farm/core/device/screen-ready";

import { execFileText, type Exec } from "./exec";
import { clickButtonScript } from "./ios-driver";

/** 앱 안의 WebView 전부를 한 브라우저로 본다. 가드·로그는 context에 건다(스택마다 새 WebView가 생긴다). */
export type AndroidScreenDriver = ScreenDriver & { context: BrowserContext };

const devtoolsWaitMs = 30_000;
const pageWaitMs = 10_000;
const pollMs = 250;
const clickMarkAttribute = "data-device-farm-click";
// iOS 스크립트에서 누르기만 표시로 바꾼다. 이름 규칙은 그대로 같다.
const markButtonScript = clickButtonScript.replace(
  "target.click();",
  `document.querySelectorAll("[${clickMarkAttribute}]").forEach((el) => el.removeAttribute("${clickMarkAttribute}")); target.setAttribute("${clickMarkAttribute}", "");`,
);
if (markButtonScript === clickButtonScript) throw new Error("clickButtonScript에 target.click()이 없습니다.");
/** 버튼이 그려지기를 기다리는 시간 (작성자 판단, 플로우 스텝 대기와 같다) */
const clickWaitMs = 10_000;
/** 누를 위치가 멈췄는지 다시 재는 횟수·간격 (작성자 판단, 캐러셀 넘김 애니메이션 약 0.5초) */
const settleSamples = 8;
const settleSampleMs = 120;
/** 스택을 닫은 직후 같은 경로 push를 막는 앱이 있다(중복 push 방지). 그 시간보다 넉넉히 기다린다. iOS 드라이버와 같은 값. */
const stackSettleMs = 600;

const execFileBuffer = promisify(execFile);

/** 누를 자리(웹 CSS 좌표)와 화면 좌표로 바꿀 비율. 링크면 href. */
type TapPoint = { x: number; y: number; ratio: number; viewHeight: number; href: string | null; blocked?: string };

const webViewBoundsPattern = /class="android\.webkit\.WebView"[^>]*bounds="\[(\d+),(\d+)\]/;

/**
 * 키보드가 떠 있으면 스택을 닫기 전에 뒤로 키로 내린다. 입력칸이 살아 있을 때 뒤로 키는 키보드만 닫는다.
 * 들어오자마자 키보드를 띄우는 금액 입력 화면을 그대로 스택을 코드로 닫으면
 * 입력칸 없이 키보드만 남아 하단 탭을 덮는다. 사람이 화면 뒤로 버튼으로 나가면 정상으로 닫힌다.
 */
async function hideKeyboard(exec: Exec, serial: string): Promise<void> {
  const state = await exec("adb", ["-s", serial, "shell", "dumpsys", "input_method"]).catch(() => "");
  if (!state.includes("mInputShown=true")) return;
  await exec("adb", ["-s", serial, "shell", "input", "keyevent", "KEYCODE_BACK"]);
  await wait(stackSettleMs);
}

/** 네이티브 화면을 닫으려고 뒤로 키를 누르는 최대 횟수 (작성자 판단, 목록 → 상세 두 겹) */
const nativeBackAttempts = 3;

/**
 * 앱 안 네이티브 화면(광고 오퍼월 등)이 위에 있으면 메인 화면(`android.mainActivity`)이 나올 때까지 뒤로 키를 누른다.
 * 그 화면에는 WebView가 없어 홈 이동이 「웹 화면을 찾지 못했습니다」로 실패하고 남은 플로우가 전부 막힌다.
 * 다른 앱(공유 시트 등)이 위에 있으면 누르지 않는다. 뒤로 키가 그 앱 안에서 엉뚱하게 움직일 수 있다.
 */
export function isAppNativeScreen(windowDump: string, appId: string, mainActivity: string): boolean {
  const focus = /mCurrentFocus=Window\{[^}]* ([\w.]+)\/([\w.$]+)\}/.exec(windowDump);
  return focus !== null && focus[1] === appId && focus[2] !== mainActivity;
}

async function leaveNativeScreens(exec: Exec, serial: string, appId: string, mainActivity: string | undefined): Promise<void> {
  if (!mainActivity) return;
  for (let attempt = 0; attempt < nativeBackAttempts; attempt += 1) {
    const dump = await exec("adb", ["-s", serial, "shell", "dumpsys", "window"]).catch(() => "");
    if (!isAppNativeScreen(dump, appId, mainActivity)) return;
    await exec("adb", ["-s", serial, "shell", "input", "keyevent", "KEYCODE_BACK"]);
    await wait(stackSettleMs);
  }
}

/** dev 빌드 AdMob 광고 검증 팝업의 닫기 버튼. 하단 탭 자리를 덮어 탭을 막는다. */
const adValidatorDismissPattern = /text="Dismiss"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/;

/** 팝업은 화면 아래 약 30%를 덮는다(실측). 그보다 넉넉히 위에서부터 본다 (작성자 판단). */
const adValidatorTopRatio = 0.6;
/**
 * 링크를 누를 세로 위치 비율 (작성자 판단, 하단 탭 실측). 버튼은 가운데를 누른다:
 * 화면 맨 아래 버튼(풀팝업 취소 버튼)을 아래쪽으로 누르면 바로 밑 네이티브 탭바에 닿았다.
 */
const linkTapHeightRatio = 0.75;
/**
 * 링크를 누른 뒤 도착을 기다리는 시간·누르는 횟수 (작성자 판단).
 * 앱을 막 띄운 직후 홈 탭은 누르고 5.6초 뒤에야 경로가 바뀌었다(자리 잡은 뒤에는 0.8초).
 * 5초로 두면 늦게 도착한 것을 놓쳐 홈 이동 실패로 보았다. 다시 누르는 것은 느린 이동을 빠르게 하지 못한다.
 */
const linkArriveWaitMs = 12_000;
const linkTapAttempts = 2;
/** 시작 전에 시트 닫기(`webview.sheetCloseName`)를 누르는 최대 횟수(시트가 겹쳐 뜨는 경우) (작성자 판단) */
const sheetCloseAttempts = 3;
/** 이름이 `closeName`인 버튼 중 그 자리 맨 위가 자기 자신인 것(사람이 누를 수 있는 것)의 가운데. 없으면 팝업 바깥 딤, 그것도 없으면 null */
const reachableCloseScript = (closeName: string) => `(() => {
  const nameOf = (n) => (n.getAttribute("aria-label") || n.innerText || n.title || "").replace(/\\s+/g, " ").trim();
  for (const el of Array.from(document.querySelectorAll('button, [role="button"]'))) {
    if (nameOf(el) !== ${JSON.stringify(closeName)}) continue;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    const x = r.x + r.width / 2;
    const y = r.y + r.height / 2;
    if (x < 0 || x > innerWidth || y < 0 || y > innerHeight) continue;
    const hit = document.elementFromPoint(x, y);
    if (hit && (hit === el || el.contains(hit))) return { x, y, ratio: devicePixelRatio, viewHeight: innerHeight, href: null };
  }
  // 닫기가 없는 팝업(「다시 풀기」만 있는 시간 초과 팝업 등)은 사람처럼 팝업 바깥 딤을 눌러 닫는다
  const dialog = document.querySelector('[role="dialog"], [aria-modal="true"]');
  if (!dialog) return null;
  for (const ratio of [0.12, 0.88]) {
    const x = innerWidth / 2;
    const y = innerHeight * ratio;
    const hit = document.elementFromPoint(x, y);
    if (hit && !dialog.contains(hit) && /dim|overlay|backdrop/i.test(String(hit.className) + " " + (hit.getAttribute("data-state") || ""))) {
      return { x, y, ratio: devicePixelRatio, viewHeight: innerHeight, href: null };
    }
  }
  return null;
})()`;

/**
 * `allWindows`는 앱 위에 따로 뜬 창(AdMob 검증 팝업)까지 담는다. 기본 덤프에는 그 팝업이 없다.
 * 대신 광고 WebView 창도 섞여 WebView 위치는 기본 덤프로 읽는다.
 */
async function dumpScreen(exec: Exec, serial: string, allWindows: boolean): Promise<string> {
  const dumpPath = "/sdcard/device-farm-ui.xml";
  await exec("adb", ["-s", serial, "shell", "uiautomator", "dump", ...(allWindows ? ["--windows"] : []), dumpPath]);
  return exec("adb", ["-s", serial, "shell", "cat", dumpPath]);
}

/** 화면에서 WebView가 시작하는 픽셀 좌표(상태바 아래). 웹 좌표 × devicePixelRatio에 더하면 화면 좌표다. */
export function webViewOrigin(screen: string): { x: number; y: number } {
  const match = webViewBoundsPattern.exec(screen);
  if (!match) throw new Error("화면에서 WebView 위치를 찾지 못했습니다(uiautomator).");
  return { x: Number(match[1]), y: Number(match[2]) };
}

/**
 * AdMob 검증 팝업이 떠 있으면 「Dismiss」를 누른다. 운영 빌드에는 없다.
 * 광고가 새로 뜰 때마다 다시 나타나 탭마다 확인한다(홈 탭을 덮을 수 있다).
 */
async function dismissAdValidator(exec: Exec, serial: string, screen: string): Promise<void> {
  const match = adValidatorDismissPattern.exec(screen);
  if (!match) return;
  const [left, top, right, bottom] = match.slice(1).map(Number);
  await exec("adb", ["-s", serial, "shell", "input", "tap", String(Math.round((left + right) / 2)), String(Math.round((top + bottom) / 2))]);
  await wait(stackSettleMs);
}

/** 앱 프로세스 id. 안 떠 있으면 빈 문자열 */
async function appPid(exec: Exec, serial: string, appId: string): Promise<string> {
  return (await exec("adb", ["-s", serial, "shell", "pidof", appId]).catch(() => "")).trim().split(/\s+/)[0] ?? "";
}

/**
 * 앱 프로세스의 WebView 디버깅 소켓. 앱이 WebView 디버깅을 켜지 않았으면 끝내 안 생긴다.
 * 설치 없이 도는 점검(플로우만 점검 등)은 앱이 떠 있다고 보고 붙었는데, 앱이 꺼져 있으면 30초 기다리다 실패했다.
 * 그래서 앱이 안 떠 있으면 먼저 띄운다.
 */
async function devtoolsSocket(exec: Exec, serial: string, appId: string): Promise<string> {
  if (!(await appPid(exec, serial, appId))) {
    await exec("adb", ["-s", serial, "shell", "monkey", "-p", appId, "1"]).catch(() => "");
  }
  const deadline = Date.now() + devtoolsWaitMs;
  while (Date.now() < deadline) {
    const pid = await appPid(exec, serial, appId);
    const name = `webview_devtools_remote_${pid}`;
    if (pid && (await exec("adb", ["-s", serial, "shell", "cat", "/proc/net/unix"])).includes(`@${name}`)) return name;
    await wait(pollMs);
  }
  throw new Error(`${appId} WebView 디버깅 소켓이 없습니다. WebView 디버깅을 켠 빌드인지 확인하세요.`);
}

async function connect(exec: Exec, serial: string, appId: string): Promise<Browser> {
  const socket = await devtoolsSocket(exec, serial, appId);
  const port = (await exec("adb", ["-s", serial, "forward", "tcp:0", `localabstract:${socket}`])).trim();
  return chromium.connectOverCDP(`http://127.0.0.1:${port}`);
}

/** 앱 웹 주소의 페이지. 광고(AdMob `/afma/...`) WebView도 같은 프로세스에 붙어서 걸러 낸다. */
export function appPages(context: Pick<BrowserContext, "pages">, origin: string): Page[] {
  return context.pages().filter((page) => !page.isClosed() && page.url().startsWith(origin));
}

const pathOf = (page: Page) => new URL(page.url()).pathname;

/**
 * 지금 보이는 화면을 따라간다. 앱은 스택 화면마다 WebView를 새로 쌓고, 탭 루트는 탭마다 이미 있는 WebView를 앞으로 꺼낸다.
 * 그래서 "새로 생긴 페이지"가 있으면 그것, 없으면 마지막으로 고른 페이지, 그것도 없으면 마지막 앱 페이지다.
 */
export function createPageTracker(context: Pick<BrowserContext, "pages">, origin: string) {
  let pinned: Page | null = null;
  let known = new Set<Page>(context.pages());
  const pin = (page: Page) => {
    pinned = page;
    known = new Set(context.pages());
    return page;
  };
  const current = (): Page => {
    const pages = appPages(context, origin);
    const fresh = pages.filter((page) => !known.has(page)).at(-1);
    if (fresh) return pin(fresh);
    if (pinned && !pinned.isClosed()) return pinned;
    const last = pages.at(-1);
    if (last) return pin(last);
    // 로그인 화면이 네이티브인 앱은 그때 앱 웹 페이지가 하나도 없다.
    throw new Error("Android 앱에서 웹 화면을 찾지 못했습니다. 로그아웃돼 네이티브 로그인 화면일 수 있습니다.");
  };
  /** 딥링크 뒤: 새 페이지 또는 목표 경로의 기존 페이지(탭 루트)를 기다린다. 끝내 없으면 지금 화면. */
  const arrive = async (path: string, waitMs = pageWaitMs): Promise<Page> => {
    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
      const pages = appPages(context, origin);
      const fresh = pages.filter((page) => !known.has(page)).at(-1);
      if (fresh) return pin(fresh);
      const tab = pages.find((page) => samePath(path, pathOf(page)));
      if (tab) {
        // 탭 WebView는 오래 산다. 앞 실행이 남긴 "안 열림" 표시를 지워야 도착으로 본다.
        await tab.evaluate(`delete window.${staleMarkKey}`).catch(() => undefined);
        return pin(tab);
      }
      await wait(pollMs);
    }
    return current();
  };
  const forget = () => {
    known = new Set(context.pages());
  };
  return { current, arrive, forget };
}

/**
 * Android 화면 드라이버. iOS처럼 화면을 앱 딥링크로 열어 실제 사용자 진입(스택 push)을 탄다.
 * location 이동은 WebView에 따라 막혀 외부 브라우저로 튕길 수 있다.
 */
export async function openAndroidDriver(serial: string, appId: string, webOrigin: string, app: AppConfig, exec: Exec = execFileText): Promise<AndroidScreenDriver> {
  const { homeTabName, inPageBackNames } = app;
  const { stackResetScript, sheetCloseName, overlayCloseScript } = app.webview;
  const browser = await connect(exec, serial, appId);
  const context = browser.contexts()[0];
  if (!context) {
    await browser.close();
    throw new Error("Android WebView 컨텍스트가 없습니다.");
  }
  const origin = new URL(webOrigin).origin;
  // connectOverCDP 직후에는 페이지가 아직 안 붙어 있을 수 있다. 앱 페이지가 보일 때까지 기다린다.
  const deadline = Date.now() + pageWaitMs;
  while (appPages(context, origin).length === 0 && Date.now() < deadline) await wait(pollMs);
  const pages = createPageTracker(context, origin);
  // 줄바꿈·연속 공백은 한 칸으로 본다(iOS hasTextScript와 같은 규칙).
  const squash = (value: string) => value.replace(/\s+/g, " ").trim();
  const hasText = async (text: string) => squash(await pages.current().locator("body").innerText()).includes(squash(text));

  let webViewTopLeft: { x: number; y: number } | null = null;

  /**
   * 이름 규칙으로 요소를 찾아 누를 자리를 돌려준다. 찾기와 좌표 읽기를 한 번의 evaluate로 한다.
   * 따로 하면 그사이 화면이 다시 그려져 표시가 사라진다(금액 입력 키패드 등).
   * 누를 자리는 위치가 멈출 때까지 다시 재고(스크롤·전환 애니메이션·자동으로 넘어가는 캐러셀), 그 자리 맨 위 요소가 대상일 때만 돌려준다.
   * 캐러셀 슬라이드를 재는 사이 슬라이드가 넘어가 화면 밖을 누르고, 밀린 화면에서 엉뚱한 버튼을 누른 적이 있다.
   * 화면 밖이거나 가려졌으면 `blocked`에 이유를 담는다.
   */
  const locate = async (page: Page, name: string, role: ClickRole, match: ClickMatch = "exact"): Promise<TapPoint | null> => {
    const script = `(async function () {
      if (!(function () { ${markButtonScript} }).apply(null, [${JSON.stringify(name)}, ${JSON.stringify(role)}, ${JSON.stringify(match)}])) return null;
      const el = document.querySelector("[${clickMarkAttribute}]");
      // 가운데로 올린다. 화면 아래 끝에 두면 떠 있는 하위 메뉴 밑에 깔려 탭이 그쪽에 간다.
      el.scrollIntoView({ block: "center", inline: "nearest" });
      const read = () => { const r = el.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; };
      let rect = read();
      for (let i = 0; i < ${settleSamples}; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, ${settleSampleMs}));
        const next = read();
        const still = next.every((value, k) => Math.abs(value - rect[k]) < 1);
        rect = next;
        if (still) break;
      }
      const baseY = ${role === "link" ? linkTapHeightRatio : 0.5};
      const at = (fx, fy) => ({ x: rect[0] + rect[2] * fx, y: rect[1] + rect[3] * fy });
      const center = at(0.5, baseY);
      const point = (spot) => ({ x: spot.x, y: spot.y, ratio: window.devicePixelRatio, viewHeight: window.innerHeight, href: el.getAttribute("href") });
      const inView = (spot) => spot.x >= 0 && spot.x <= window.innerWidth && spot.y >= 0 && spot.y <= window.innerHeight;
      if (!inView(center)) return { ...point(center), blocked: "화면 밖에 있습니다" };
      // 스택 아래 화면의 같은 이름 버튼을 찾았어도, 그 자리 맨 위가 같은 이름 버튼이면 그걸 누르는 것과 같다
      const nameOf = (node) => (node.getAttribute("aria-label") || node.innerText || node.title || "").replace(/\\s+/g, " ").trim();
      const reaches = (hit) => {
        if (!hit) return false;
        if (hit === el || el.contains(hit)) return true;
        const twin = hit.closest ? hit.closest('button, [role="button"], a[href], [role="link"]') : null;
        return Boolean(twin) && twin !== el && nameOf(twin) === nameOf(el);
      };
      // 가운데가 떠 있는 광고(iframe) 등에 덮이면 요소 안 다른 자리를 쓴다(상품 카드 위 광고 등)
      const spots = [[0.5, baseY], [0.25, baseY], [0.75, baseY], [0.5, 0.25], [0.15, baseY], [0.85, baseY]].map(([fx, fy]) => at(fx, fy)).filter(inView);
      const free = spots.find((spot) => reaches(document.elementFromPoint(spot.x, spot.y)));
      if (free) return point(free);
      const hit = document.elementFromPoint(center.x, center.y);
      const label = hit ? hit.tagName.toLowerCase() + (typeof hit.className === "string" && hit.className ? "." + hit.className.split(/\\s+/).slice(0, 2).join(".") : "") : "없음";
      return { ...point(center), blocked: "다른 요소(" + label + ")에 가려져 있습니다" };
    })()`;
    return page.evaluate<TapPoint | null>(script).catch(() => null);
  };

  /**
   * 화면 좌표로 실제 탭. 하단 탭바를 네이티브가 덮는 앱은 웹 요소에 보낸 클릭(CDP)으로 탭이 안 바뀐다.
   * adb `input tap`은 사람 손가락과 같은 자리를 누른다. 링크는 세로 3/4 지점을 누른다:
   * 하단 탭은 WebView 아래 끝에 걸쳐 있어 가운데를 누르면 네이티브 탭바 경계에 닿아 안 먹을 수 있다.
   */
  const tapAt = async (point: TapPoint, forcePopupCheck: boolean, relocate?: () => Promise<TapPoint | null>) => {
    // uiautomator 덤프는 3초쯤 걸린다. WebView 위치는 한 번만, 팝업은 팝업이 덮는 화면 아래쪽을 누를 때만 본다.
    const inPopupArea = point.y > point.viewHeight * adValidatorTopRatio;
    webViewTopLeft ??= webViewOrigin(await dumpScreen(exec, serial, false));
    if (inPopupArea || forcePopupCheck) {
      // 팝업 확인은 보조다. `--windows` 덤프가 가끔 실패해도 누르기는 그대로 한다.
      const screen = await dumpScreen(exec, serial, true).catch(() => "");
      await dismissAdValidator(exec, serial, screen);
      // 덤프하는 3초 사이 화면이 움직였을 수 있다(캐러셀). 누르기 직전에 다시 잰다.
      // 다시 못 찾으면(맨 위 WebView가 바뀌는 중 등) 처음 잰 자리를 쓴다. 가려졌다고 확인된 경우에만 멈춘다.
      const fresh = relocate ? await relocate() : point;
      if (fresh?.blocked) throw new Error(`누르기 직전 위치가 바뀌었습니다: ${fresh.blocked}.`);
      if (fresh) point = fresh;
    }
    const x = Math.round(webViewTopLeft.x + point.x * point.ratio);
    const y = Math.round(webViewTopLeft.y + point.y * point.ratio);
    await exec("adb", ["-s", serial, "shell", "input", "tap", String(x), String(y)]);
  };

  /**
   * 링크는 그 경로에 도착해야 누른 것이다. 하단 탭은 팝업이 탭 직전에 다시 떠서 한 번 안 먹을 수 있다.
   * 그때만 팝업을 다시 보고 한 번 더 누른다.
   */
  const followLink = async (point: TapPoint, name: string, path: string, relocate: () => Promise<TapPoint | null>) => {
    for (let attempt = 0; attempt < linkTapAttempts; attempt += 1) {
      if (attempt > 0) {
        // 다시 누를 때는 위치를 새로 잰다. 이미 다른 화면이면(늦게 도착) 찾지 못해도 도착 여부만 본다.
        const fresh = await relocate();
        if (fresh && !fresh.blocked) await tapAt(fresh, true, relocate);
      }
      if (samePath(path, pathOf(await pages.arrive(path, linkArriveWaitMs)))) return;
    }
    throw new Error(`「${name}」 링크를 눌렀지만 ${path}로 가지 않았습니다.`);
  };

  /**
   * 시작 준비: 탭 화면에 뜬 이벤트 바텀시트·팝업의 닫기를 누른다. 시트의 딤이 하단 탭 탭을 막는다.
   * 플로우 도중에는 쓰지 않는다.
   */
  const closeSheets = async () => {
    for (let attempt = 0; attempt < sheetCloseAttempts; attempt += 1) {
      // 닫기가 여럿이면(딤 뒤에 깔린 다른 시트) 지금 누를 수 있는 것을 고른다. 첫 번째만 보면 가려진 것을 집고 그냥 넘어가
      // 시트 딤이 남아 다음 플로우가 전부 홈 탭을 못 눌렀다
      const point = await pages.current().evaluate<TapPoint | null>(reachableCloseScript(sheetCloseName)).catch(() => null);
      if (!point) return;
      await tapAt(point, false);
      await wait(stackSettleMs);
    }
  };

  /**
   * 메인 WebView 안에서 열린 화면은 탭바가 없고 스택 닫기로도 안 닫힌다.
   * 시스템 뒤로 키 대신 그 화면 상단의 앱 뒤로 버튼을 누른다(뒤로 키가 공유 창을 연 적이 있다).
   */
  const leaveInPageScreen = async () => {
    for (const name of inPageBackNames) {
      const point = await locate(pages.current(), name, "button");
      if (!point || point.blocked) continue;
      await tapAt(point, false);
      await wait(stackSettleMs);
      return;
    }
  };

  const clickButton = async (name: string, role: ClickRole = "button", match: ClickMatch = "exact") => {
    // iOS와 같은 이름 규칙(글자 기준). Playwright 접근 가능한 이름은 아이콘 alt까지 붙여 「채팅 채팅」이 된다.
    // JS click()은 제스처가 필요한 스택 이동을 안 일으킨다. 찾기만 하고 실제 탭으로 누른다.
    const deadline = Date.now() + clickWaitMs;
    let lastBlocked: string | undefined;
    for (;;) {
      // 앱을 막 다시 띄우면 WebView를 새로 만드는 동안 앱 페이지가 잠깐 하나도 없다(재시작 직후).
      // 누를 때까지 기다리는 시간 안에서는 다시 찾는다. 끝내 없으면 그 오류(로그인 화면일 수 있음)를 그대로 낸다.
      let page: Page;
      try {
        page = pages.current();
      } catch (error) {
        if (Date.now() >= deadline) throw error;
        await wait(pollMs);
        continue;
      }
      // 홈 탭은 웹 배포마다 글자가 다를 수 있어(`homeTabLabels`) 화면에 있는 글자를 고른다
      let label = name;
      let point: TapPoint | null = null;
      for (const candidate of clickLabels(app, name, role)) {
        const found = await locate(page, candidate, role, match);
        if (!found) continue;
        label = candidate;
        point = found;
        if (!found.blocked) break;
      }
      const relocate = () => locate(page, label, role, match);
      // 화면 밖·가려짐은 기다린다(캐러셀이 돌아오거나 토스트·전환이 끝나면 누를 수 있다).
      if (point && !point.blocked) {
        await tapAt(point, false, relocate);
        // 하단 탭 링크는 탭마다 따로 있는 WebView를 앞으로 꺼낼 수 있다. 링크 경로의 화면으로 옮겨 간다.
        if (point.href) await followLink(point, name, new URL(point.href, page.url()).pathname, relocate);
        return;
      }
      lastBlocked = point?.blocked;
      if (Date.now() >= deadline) {
        const what = role === "link" ? "링크" : "버튼";
        throw new Error(lastBlocked ? `"${name}" ${role === "link" ? "링크가" : "버튼이"} ${lastBlocked}. 누르지 않았습니다.` : `"${name}" ${what}를 찾지 못했습니다.`);
      }
      await wait(pollMs);
    }
  };

  const resetStack = (page: Page) => (stackResetScript ? page.evaluate(stackResetScript).catch(() => undefined) : Promise.resolve(undefined));

  return {
    app,
    context,
    navigate: async (path) => {
      // 0) 앞 화면이 띄운 키보드를 내린다. 안 내리면 스택만 닫혀 키보드가 다음 화면들 스크린샷에 계속 찍힌다.
      // 1) 앞 화면 스택을 닫는다. 2) pop 직후 같은 경로 차단을 피해 기다린다. 3) 딥링크. 4) 그 화면으로.
      await hideKeyboard(exec, serial);
      await resetStack(pages.current());
      await wait(stackSettleMs);
      // 딥링크가 안 먹으면 이 문서를 그대로 보게 된다. 표시를 남겨 "안 열림"을 알아본다.
      await pages.current().evaluate(markStaleScript).catch(() => undefined);
      pages.forget();
      // adb shell은 기기 sh에 한 줄로 넘긴다. 쿼리의 &가 끊기지 않게 작은따옴표로 감싼다.
      await exec("adb", ["-s", serial, "shell", "am", "start", "-W", "-a", "android.intent.action.VIEW", "-d", `'${deepLinkUrl(path, app.deepLink)}'`, appId]);
      await pages.arrive(path);
    },
    clickButton,
    goHome: async () => {
      // 딥링크 없이: 스택을 닫고 하단 홈 탭을 실제로 누른다. 탭바는 웹 링크다.
      // 연결 직후에는 어느 페이지가 맨 위인지 모른다. 앱 페이지 전부에 보내 스택을 확실히 닫는다.
      // 닫히는 중인 스택 화면을 맨 위로 잘못 보면 한 번 빗나간다. 그때만 한 번 더 한다.
      let lastError: unknown;
      for (let attempt = 0; attempt < homeAttempts; attempt += 1) {
        try {
          await leaveNativeScreens(exec, serial, appId, app.android.mainActivity);
          await hideKeyboard(exec, serial);
          await Promise.all(appPages(context, origin).map(resetStack));
          await wait(stackSettleMs);
          pages.forget();
          // 화면 전체를 덮는 창(상담 채팅 메신저 iframe 등)은 스택 닫기·시트 닫기·시스템 뒤로로 안 닫힌다. 앱 설정의 닫기 스크립트를 보낸다
          if (overlayCloseScript) await Promise.all(appPages(context, origin).map((page) => page.evaluate(overlayCloseScript).catch(() => undefined)));
          await closeSheets();
          await clickButton(homeTabName, "link");
          return;
        } catch (error) {
          lastError = error;
          await leaveInPageScreen();
        }
      }
      throw lastError;
    },
    expectText: async (text, timeoutMs) => {
      const deadline = Date.now() + timeoutMs;
      // 버튼이 새 WebView를 쌓으면 맨 위 페이지가 바뀐다. 매번 다시 찾는다.
      while (!(await hasText(text).catch(() => false))) {
        if (Date.now() >= deadline) throw new Error(`"${text}" 문구가 ${timeoutMs}ms 안에 나오지 않았습니다.`);
        await wait(pollMs);
      }
    },
    currentPath: async () => pathOf(pages.current()),
    hasText,
    screenshot: async () => (await execFileBuffer("adb", ["-s", serial, "exec-out", "screencap", "-p"], { encoding: "buffer", maxBuffer: 64 * 1024 * 1024 })).stdout,
    evaluate: async <T>(script: string) => pages.current().evaluate<T>(script),
    close: () => browser.close(),
  };
}

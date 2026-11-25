import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as wait } from "node:timers/promises";

import { PNG } from "pngjs";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

import type { AppConfig } from "@device-farm/core/config/app-config";
import { deepLinkUrl } from "@device-farm/core/device/deep-link";
import { clickLabels, gatewayErrorOf, gatewayFailureMessage, homeAttempts, networkRetryDelaysMs, waitOutGateway as waitOutGatewayScreen, webErrorCode, webErrorUrlPrefix, type ClickMatch, type ClickRole, type NetworkRecovery, type ScreenDriver } from "@device-farm/core/device/driver";
import { devChipBlocked, hiddenPagePrefix } from "@device-farm/core/device/infra-error";
import { markStaleScript, samePath, staleMarkKey } from "@device-farm/core/device/screen-ready";

import { watchNativeAd } from "./ad-watch";
import { createContextHooks, type ContextHooks } from "./context-hooks";
import { devChipBoxes, devPreviewClosePoint, inBoxes, type ScreenBox } from "./dev-overlay";
import { kakaoAccountsHost, notificationAllowPoint, reloginWithKakao, selectKakaoAccountScript, type KakaoLoginResult } from "./kakao-login";
import { execFileText, type Exec } from "./exec";
import { clickButtonScript } from "./ios-driver";

/** 앱 안의 WebView 전부를 한 브라우저로 본다. 가드·로그는 context에 건다(스택마다 새 WebView가 생긴다). */
export type AndroidScreenDriver = ScreenDriver & {
  context: BrowserContext;
  /** 지금 연결에 걸고, 다시 붙으면 새 연결에도 건다(쓰기 가드·로그 수집). `context`에 직접 걸면 다시 붙을 때 사라진다 */
  attachContext: ContextHooks<BrowserContext>["attach"];
};

const devtoolsWaitMs = 30_000;
const pageWaitMs = 10_000;
const pollMs = 250;
/**
 * 웹 화면에 스크립트를 돌려 답을 기다리는 최대 시간 (작성자 판단). Playwright evaluate는 시간 제한이 없어,
 * WebView가 멈추면 점검 전체가 끝없이 기다렸다(플로우 하나가 몇 시간씩 멈추고 대기열이 막힘).
 */
export const evaluateTimeoutMs = 20_000;
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

/** 포커스된 창 `<package>/<activity>`. 못 읽으면 "" */
async function focusedWindow(exec: Exec, serial: string): Promise<string> {
  const dump = await exec("adb", ["-s", serial, "shell", "dumpsys", "window"]).catch(() => "");
  const focus = /mCurrentFocus=Window\{[^}]* ([\w.]+)\/([\w.$]+)\}/.exec(dump);
  return focus ? `${focus[1]}/${focus[2]}` : "";
}

/**
 * 앱 알림 권한 창이 앞이면 「허용」을 누른다 — 앱 설정 `android.notificationAppLabel`이 있을 때만. 다른 권한 창은 누르지 않는다.
 * 앱 데이터가 지워진 뒤 로그인하면 뜨고, 뒤로 키로는 안 닫혀 홈 이동을 막는다.
 */
async function allowNotificationPrompt(exec: Exec, serial: string, appLabel: string | undefined): Promise<boolean> {
  if (!appLabel) return false;
  if (!(await focusedWindow(exec, serial)).includes("permissioncontroller/")) return false;
  const point = notificationAllowPoint(await dumpScreen(exec, serial, false).catch(() => ""), appLabel);
  if (!point) return false;
  await exec("adb", ["-s", serial, "shell", "input", "tap", String(point.x), String(point.y)]);
  await wait(stackSettleMs);
  console.log(`[farm] ${serial} 앱 알림 권한 창에서 「허용」을 눌렀습니다.`);
  return true;
}

async function leaveNativeScreens(exec: Exec, serial: string, appId: string, mainActivity: string | undefined, notificationAppLabel: string | undefined): Promise<void> {
  await allowNotificationPrompt(exec, serial, notificationAppLabel);
  if (!mainActivity) return;
  for (let attempt = 0; attempt < nativeBackAttempts; attempt += 1) {
    const dump = await exec("adb", ["-s", serial, "shell", "dumpsys", "window"]).catch(() => "");
    if (!isAppNativeScreen(dump, appId, mainActivity)) return;
    await exec("adb", ["-s", serial, "shell", "input", "keyevent", "KEYCODE_BACK"]);
    await wait(stackSettleMs);
  }
}

/** 앱 네이티브 화면에서 뒤로 키를 누른 뒤 웹 화면이 다시 붙기를 기다리는 시간 (작성자 판단) */
const nativeRouteBackWaitMs = 4_000;

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

/**
 * 누르기 직전에 모든 앱 페이지에 거는 기록기. 이후 새로 붙은 글자를 `window.__farmSeen`에 쌓는다(다시 걸면 비운다).
 * 토스트는 누르기 단계(덤프·위치 다시 재기)가 끝나기 전에 떴다 사라질 수 있다.
 * 그러면 뜬 문구를 문구 확인이 놓친다.
 */
export const seenTextKey = "__farmSeen";
export const armSeenTextScript = `(() => {
  const key = ${JSON.stringify(seenTextKey)};
  if (window[key]) { window[key].length = 0; return true; }
  const seen = (window[key] = []);
  const add = (value) => {
    const text = (value || "").replace(/\s+/g, " ").trim();
    if (!text) return;
    seen.push(text.slice(0, 300));
    if (seen.length > 200) seen.shift();
  };
  new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "characterData") add(record.target.textContent);
      for (const node of record.addedNodes) add(node.nodeType === 1 ? node.innerText || node.textContent : node.textContent);
    }
  }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  return true;
})()`;

/**
 * 다시 보지 않기류 기록(쿠키·localStorage)을 지우는 웹 스크립트. 이름에 dismiss·temp_hide·hide_until·today가 든 것만.
 * 로그인·세션 기록은 이름이 달라 건드리지 않는다.
 */
export const clearDismissPattern = /(dismiss|temp_hide|hide_until|hideuntil|today)/i;
export const clearDismissScript = `(() => {
  const pattern = ${clearDismissPattern.toString()};
  const cleared = [];
  for (const part of document.cookie.split(";")) {
    const name = part.split("=")[0].trim();
    if (!name || !pattern.test(name)) continue;
    document.cookie = name + "=; Max-Age=0; path=/";
    cleared.push(name);
  }
  for (const key of Object.keys(localStorage)) {
    if (!pattern.test(key)) continue;
    localStorage.removeItem(key);
    cleared.push(key);
  }
  return cleared;
})()`;

/** uiautomator 덤프의 글자(text·content-desc). 지금 화면에 그려진 것만 들어 있다 */
export function screenTexts(dump: string): string[] {
  const texts: string[] = [];
  for (const match of dump.matchAll(/ (?:text|content-desc)="([^"]*)"/g)) {
    const value = match[1].replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").trim();
    if (value) texts.push(value);
  }
  return texts;
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

/** 권한 창(알림 허용 등)은 앱 앞에 떠도 따로 다룬다(`allowNotificationPrompt`) */
const systemPromptPackages = ["com.google.android.permissioncontroller", "com.android.permissioncontroller"] as const;

/** 앱도 권한 창도 아닌 다른 앱이 앞인가. 포커스를 못 읽으면 false */
export async function foreignAppInFront(exec: Exec, serial: string, appId: string): Promise<boolean> {
  const focus = await focusedWindow(exec, serial);
  const app = focus.split("/")[0];
  return app !== "" && app !== appId && !(systemPromptPackages as readonly string[]).includes(app);
}

/** 앱 프로세스의 WebView 디버깅 소켓 이름. 없으면 null */
async function devtoolsSocketName(exec: Exec, serial: string, appId: string): Promise<string | null> {
  const pid = await appPid(exec, serial, appId);
  const name = `webview_devtools_remote_${pid}`;
  return pid && (await exec("adb", ["-s", serial, "shell", "cat", "/proc/net/unix"]).catch(() => "")).includes(`@${name}`) ? name : null;
}

/**
 * 앱이 떠 있고 앱 웹 화면 창(MainActivity)이 앞인데 WebView 디버깅 소켓이 없으면 앱을 다시 켠다. 다시 켰으면 true.
 * 광고 오퍼월 SDK를 다녀오면 같은 프로세스에서 디버깅 소켓이 사라지기도 한다(SDK가 WebView 디버깅을 프로세스 전체에서 끄는 것으로 보인다).
 * 화면은 앱 웹으로 돌아왔지만 붙을 곳이 없어 뒤 점검이 전부 「웹 화면을 찾지 못했습니다」로 실패한다. 앱을 다시 켜면 소켓이 돌아온다.
 */
export async function relaunchIfDevtoolsOff(exec: Exec, serial: string, appId: string, mainActivity: string | undefined): Promise<boolean> {
  if (!mainActivity) return false;
  if (!(await appPid(exec, serial, appId))) return false;
  if (await devtoolsSocketName(exec, serial, appId)) return false;
  if ((await focusedWindow(exec, serial)) !== `${appId}/${mainActivity}`) return false;
  console.log(`[farm] ${serial} WebView 디버깅 연결이 꺼져 있어(앱 안 광고 화면을 다녀온 뒤) 앱을 다시 켭니다.`);
  await relaunchApp(exec, serial, appId, mainActivity);
  return true;
}

/**
 * 앱 프로세스의 WebView 디버깅 소켓. 앱이 WebView 디버깅을 켜지 않았으면 끝내 안 생긴다.
 * 설치 없이 도는 점검(플로우만 점검 등)은 앱이 떠 있다고 보고 붙었는데, 앱이 꺼져 있으면 30초 기다리다 실패했다.
 * 그래서 앱이 안 떠 있으면 먼저 띄운다.
 */
async function devtoolsSocket(exec: Exec, serial: string, appId: string, app: AppConfig): Promise<string> {
  const { mainActivity, notificationAppLabel } = app.android;
  if (!(await appPid(exec, serial, appId))) {
    await exec("adb", ["-s", serial, "shell", "monkey", "-p", appId, "1"]).catch(() => "");
  }
  const socketName = () => devtoolsSocketName(exec, serial, appId);
  const started = Date.now();
  let triedLogin = false;
  let broughtFront = false;
  while (Date.now() - started < devtoolsWaitMs) {
    const name = await socketName();
    if (name) return name;
    // 다른 앱(광고가 연 Play 스토어 등)이 앞이면 앱 WebView가 안 생긴다. 쌓인 창을 지우고 앱을 한 번 다시 켠다.
    if (!broughtFront && (await foreignAppInFront(exec, serial, appId))) {
      broughtFront = true;
      console.log(`[farm] ${serial} 다른 앱이 앞에 있어 ${appId}을 쌓인 창을 지우고 다시 켭니다.`);
      await relaunchApp(exec, serial, appId, mainActivity).catch(() => undefined);
      continue;
    }
    // 로그아웃된 앱은 네이티브 로그인 화면이라 WebView가 없다. 잠깐 기다려도 없으면 카카오로 다시 로그인해 본다
    if (!triedLogin && Date.now() - started >= reloginAfterMs) {
      triedLogin = true;
      if ((await kakaoRelogin(app, exec, serial, async () => (await socketName()) !== null)) === "logged-in") continue;
      // 로그인 화면이 아니면: 앱 안 광고 화면(오퍼월)이 WebView 디버깅을 끈 것일 수 있다. 닫고 앱을 다시 켠다
      await leaveNativeScreens(exec, serial, appId, mainActivity, notificationAppLabel);
      await relaunchIfDevtoolsOff(exec, serial, appId, mainActivity);
    }
    await wait(pollMs);
  }
  throw new Error(`${appId} WebView 디버깅 소켓이 없습니다. WebView 디버깅을 켠 빌드인지 확인하세요.`);
}

/** 딥링크가 안 먹었을 때 다시 보내기 전 기다리는 시간 (작성자 판단) */
const deepLinkRetryWaitMs = 2_000;

/** WebView가 이만큼 안 보이면 로그아웃을 의심해 로그인 화면인지 본다 (작성자 판단) */
const reloginAfterMs = 5_000;

const screencap = async (serial: string) => (await execFileBuffer("adb", ["-s", serial, "exec-out", "screencap", "-p"], { encoding: "buffer", maxBuffer: 64 * 1024 * 1024 })).stdout;

/** Chrome 카카오 계정 선택 페이지에서 이미 로그인된 계정을 누른다. 그 페이지가 없으면 null */
async function selectKakaoAccount(exec: Exec, serial: string): Promise<string | null> {
  const port = (await exec("adb", ["-s", serial, "forward", "tcp:0", "localabstract:chrome_devtools_remote"])).trim();
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  try {
    for (const context of browser.contexts()) {
      for (const page of context.pages()) {
        if (!page.url().includes(kakaoAccountsHost)) continue;
        // 페이지가 아직 그려지는 중이면 계정이 없다. null로 돌려 다시 본다
        return await evaluateIn<string | null>(page, selectKakaoAccountScript).catch(() => null);
      }
    }
    return null;
  } finally {
    // 연결만 끊는다(Chrome은 그대로)
    await browser.close().catch(() => undefined);
    await exec("adb", ["-s", serial, "forward", "--remove", `tcp:${port}`]).catch(() => "");
  }
}

/** 로그아웃돼 앱 로그인 화면이면 카카오로 다시 로그인한다(앱 설정 `login.kakao`가 있을 때만). 로그인 화면이 아니면 아무것도 안 누른다 */
async function kakaoRelogin(app: AppConfig, exec: Exec, serial: string, appReady: () => Promise<boolean>): Promise<KakaoLoginResult> {
  if (!app.login.kakao) return "not-login";
  return reloginWithKakao(app.login.kakao, {
    screenshot: async () => PNG.sync.read(await screencap(serial)),
    tap: async (x, y) => void (await exec("adb", ["-s", serial, "shell", "input", "tap", String(x), String(y)])),
    focus: () => focusedWindow(exec, serial),
    selectAccount: () => selectKakaoAccount(exec, serial),
    appReady: () => appReady().catch(() => false),
    sleep: async (ms) => void (await wait(ms)),
    log: (message) => console.log(`[farm] ${serial} ${message}`),
  });
}

async function connect(exec: Exec, serial: string, appId: string, app: AppConfig): Promise<Browser> {
  const socket = await devtoolsSocket(exec, serial, appId, app);
  const port = (await exec("adb", ["-s", serial, "forward", "tcp:0", `localabstract:${socket}`])).trim();
  return chromium.connectOverCDP(`http://127.0.0.1:${port}`);
}

export const webErrorMessage = "앱 웹 화면이 네트워크 오류 화면(웹페이지를 사용할 수 없음)입니다.";

/** page.evaluate에 시간 제한을 둔다. 넘으면 기다림을 버리고 실패한다(멈춘 WebView에 끝없이 매달리지 않게) */
export function evaluateIn<T>(page: Pick<Page, "evaluate">, script: string, ms: number = evaluateTimeoutMs): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`웹 화면이 ${Math.round(ms / 1000)}초 안에 답하지 않았습니다(WebView 멈춤).`)), ms);
  });
  return Promise.race([page.evaluate(script) as Promise<T>, timeout]).finally(() => clearTimeout(timer));
}

/** WebView 네트워크 오류 화면(「웹페이지를 사용할 수 없음」) */
export function webErrorPages(context: Pick<BrowserContext, "pages">): Page[] {
  return context.pages().filter((page) => !page.isClosed() && page.url().startsWith(webErrorUrlPrefix));
}

/**
 * 오류 화면을 다시 불러 본다. 오류 화면의 reload는 실패했던 앱 주소를 다시 연다. 간격을 늘려 가며 몇 번 해 본다.
 * pause는 테스트 주입용.
 */
export async function reloadWebErrors(context: Pick<BrowserContext, "pages">, delays: readonly number[] = networkRetryDelaysMs, pause: (ms: number) => Promise<unknown> = wait): Promise<NetworkRecovery> {
  const broken = webErrorPages(context);
  if (broken.length === 0) return { status: "none" };
  const code = webErrorCode(await broken[0].locator("body").innerText().catch(() => ""));
  for (const delay of delays) {
    await pause(delay);
    for (const page of webErrorPages(context)) await page.reload({ timeout: pageWaitMs }).catch(() => undefined);
    if (webErrorPages(context).length === 0) return { status: "recovered", code };
  }
  return { status: "failed", code };
}

/** 새 작업으로, 쌓인 창을 지우고 띄우는 Intent 플래그(NEW_TASK | CLEAR_TASK) */
const clearTaskFlags = "0x10008000";

/**
 * 앱을 끄고 쌓인 창을 지운 채 다시 띄운다.
 * 광고가 연 Play 스토어 창이 앱 작업 안에 남아, 앱을 다시 켜도(monkey) 그 창이 다시 앞에 왔다.
 */
export async function relaunchApp(exec: Exec, serial: string, appId: string, mainActivity: string | undefined): Promise<void> {
  await exec("adb", ["-s", serial, "shell", "am", "force-stop", appId]);
  if (!mainActivity) {
    // 액티비티를 모르면 런처로 띄운다
    await exec("adb", ["-s", serial, "shell", "monkey", "-p", appId, "-c", "android.intent.category.LAUNCHER", "1"]);
    return;
  }
  await exec("adb", ["-s", serial, "shell", "am", "start", "-W", "-f", clearTaskFlags, "-n", `${appId}/${mainActivity}`]);
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
    // 네트워크 오류 화면은 주소가 chrome-error://로 바뀌어 앱 페이지가 아니게 된다. 로그아웃으로 오해하지 않게 따로 알린다
    if (webErrorPages(context).length > 0) throw new Error(webErrorMessage);
    // 로그인 화면이 네이티브인 앱은 그때 앱 웹 페이지가 하나도 없다.
    throw new Error("Android 앱에서 웹 화면을 찾지 못했습니다. 로그아웃돼 네이티브 로그인 화면일 수 있습니다.");
  };
  /** 딥링크 뒤: 새 페이지 또는 목표 경로의 기존 페이지(탭 루트)를 기다린다. 끝내 없으면 지금 화면. */
  const arrive = async (path: string, waitMs = pageWaitMs): Promise<Page> => {
    const deadline = Date.now() + waitMs;
    /** 같은 경로가 여럿인데 아직 아무것도 안 그려진다. 끝내 그러면 첫 번째로 본다 */
    let twin: Page | null = null;
    while (Date.now() < deadline) {
      const pages = appPages(context, origin);
      const fresh = pages.filter((page) => !known.has(page)).at(-1);
      if (fresh) return pin(fresh);
      const same = pages.filter((page) => samePath(path, pathOf(page)));
      // 같은 경로가 둘이면 화면에 그려지는 쪽. 첫 번째를 고르면 로딩에 멈춘 숨은 화면을 읽는다
      // 탭을 막 누른 때는 둘 다 안 그려질 수 있다. 그려지는 쪽이 나올 때까지 기다린다
      const tab = same.length > 1 ? (await paintingPages(same))[0] : same[0];
      if (!tab && same.length > 1) {
        twin = same[0];
      } else if (tab) {
        // 탭 WebView는 오래 산다. 앞 실행이 남긴 "안 열림" 표시를 지워야 도착으로 본다.
        await evaluateIn(tab, `delete window.${staleMarkKey}`).catch(() => undefined);
        return pin(tab);
      }
      await wait(pollMs);
    }
    if (twin && !twin.isClosed()) {
      await evaluateIn(twin, `delete window.${staleMarkKey}`).catch(() => undefined);
      return pin(twin);
    }
    return current();
  };
  const forget = () => {
    known = new Set(context.pages());
  };
  /**
   * 지금 읽는 페이지가 화면에 안 그려지고, 그려지는 앱 페이지가 딱 하나면 그것으로 옮긴다. 옮겼으면 true.
   * 같은 경로의 웹 화면이 둘(탭 화면·딥링크가 쌓은 화면)이면 로딩에 멈춘 숨은 쪽을 읽어, 멀쩡한 버튼이 「가려져 있습니다」로 앱 오류가 된다.
   */
  const followVisible = async (): Promise<boolean> => {
    const pages = appPages(context, origin);
    if (pages.length < 2) return false;
    const painting = await paintingPages(pages);
    if (painting.length !== 1 || painting[0] === pinned) return false;
    pin(painting[0]);
    return true;
  };
  /**
   * 읽는 페이지와 같은 경로의 페이지가 더 있고, 읽는 쪽은 안 그려지고 그려지는 쪽이 딱 하나면 그것으로 옮긴다. 옮겼으면 true.
   * 숨은 화면에서 버튼을 멀쩡히 찾아, 보이는 화면에서는 다른 버튼이 있는 자리를 누를 수 있다.
   * 못 찾았을 때만 옮기면(`followVisible`) 이 경우를 놓친다.
   */
  const followTwin = async (): Promise<boolean> => {
    const now = current();
    const twins = appPages(context, origin).filter((page) => samePath(pathOf(now), pathOf(page)));
    if (twins.length < 2) return false;
    const painting = await paintingPages(twins);
    if (painting.length !== 1 || painting[0] === now) return false;
    pin(painting[0]);
    return true;
  };
  /** 읽는 페이지는 안 그려지는데 다른 앱 페이지가 그려지고 있다(어느 것인지 하나로 못 고름). 이때의 「없음·가려짐」은 앱 문제로 보지 않는다 */
  const readingHidden = async (): Promise<boolean> => {
    const pages = appPages(context, origin);
    if (pages.length < 2) return false;
    const painting = await paintingPages(pages);
    return painting.length > 0 && !painting.includes(current());
  };
  return { current, arrive, forget, followVisible, followTwin, readingHidden };
}

/** 프레임을 세는 시간·답 제한. 숨은 WebView는 requestAnimationFrame이 한 번도 안 온다(실측: 보이는 화면 53번, 숨은 화면 0번) (작성자 판단) */
const paintSampleMs = 600;
const paintAnswerMs = 2_000;
/** 이보다 적게 그리면 보이는 화면으로 보지 않는다. 무거운 화면은 보여도 0.6초에 3번까지 떨어졌고, 막 숨는 화면은 한 번 그릴 수 있다 (작성자 판단) */
const paintMinFrames = 2;
const paintScript = `new Promise((resolve) => {
  let frames = 0;
  let done = false;
  const tick = () => { frames += 1; if (!done) requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  setTimeout(() => { done = true; resolve(frames); }, ${paintSampleMs});
})`;

/** 지금 화면에 그려지고 있는 페이지 */
export async function paintingPages<P extends Pick<Page, "evaluate">>(pages: readonly P[]): Promise<P[]> {
  const frames = await Promise.all(pages.map((page) => evaluateIn<number>(page, paintScript, paintAnswerMs).catch(() => 0)));
  return pages.filter((_, index) => frames[index] >= paintMinFrames);
}


/**
 * Android 화면 드라이버. iOS처럼 화면을 앱 딥링크로 열어 실제 사용자 진입(스택 push)을 탄다.
 * location 이동은 WebView에 따라 막혀 외부 브라우저로 튕길 수 있다.
 */
export async function openAndroidDriver(serial: string, appId: string, webOrigin: string, app: AppConfig, exec: Exec = execFileText): Promise<AndroidScreenDriver> {
  const { homeTabName, inPageBackNames } = app;
  const { stackResetScript, sheetCloseName, overlayCloseScript } = app.webview;
  const { mainActivity, notificationAppLabel, devOverlay } = app.android;
  let browser = await connect(exec, serial, appId, app);
  const first = browser.contexts()[0];
  if (!first) {
    await browser.close();
    throw new Error("Android WebView 컨텍스트가 없습니다.");
  }
  let context: BrowserContext = first;
  /** 다시 붙으면 context가 바뀐다. 페이지 목록은 늘 지금 연결에서 읽는다 */
  const live: Pick<BrowserContext, "pages"> = { pages: () => context.pages() };
  const hooks = createContextHooks(() => context);
  const origin = new URL(webOrigin).origin;
  // connectOverCDP 직후에는 페이지가 아직 안 붙어 있을 수 있다. 앱 페이지가 보일 때까지 기다린다.
  const deadline = Date.now() + pageWaitMs;
  while (appPages(live, origin).length === 0 && Date.now() < deadline) await wait(pollMs);
  if (appPages(live, origin).length === 0) {
    await kakaoRelogin(app, exec, serial, async () => appPages(live, origin).length > 0).catch(() => "not-login" as const);
  }
  await allowNotificationPrompt(exec, serial, notificationAppLabel);
  const pages = createPageTracker(live, origin);
  // 줄바꿈·연속 공백은 한 칸으로 본다(iOS hasTextScript와 같은 규칙).
  const squash = (value: string) => value.replace(/\s+/g, " ").trim();
  const hasText = async (text: string) => squash(await pages.current().locator("body").innerText()).includes(squash(text));
  /**
   * 화면에 실제로 보이는 글자(접근성 트리)에 있는지. 스택을 닫고 돌아오면 닫힌 WebView가 한동안 살아 있어
   * `pages.current()`가 그 페이지를 계속 읽는다. 돌아온 화면의 토스트를 그래서 못 본다.
   */
  /** 마지막 누르기 뒤 어느 앱 페이지에든 잠깐이라도 붙었던 글자인지(토스트) */
  const seenSinceTap = async (text: string) => {
    for (const page of appPages(live, origin)) {
      const seen = await evaluateIn<string[] | undefined>(page, `window.${seenTextKey}`).catch(() => undefined);
      if (seen?.some((item) => squash(item).includes(squash(text)))) return true;
    }
    return false;
  };
  const armSeenText = async () => {
    await Promise.all(appPages(live, origin).map((page) => evaluateIn(page, armSeenTextScript).catch(() => undefined)));
  };
  const onScreen = async (text: string) => squash(screenTexts(await dumpScreen(exec, serial, false)).join(" ")).includes(squash(text));
  /** 화면이 게이트웨이 오류(배포 중 502 등)면 풀릴 때까지 다시 불러온다. 풀리면 null, 끝내 안 풀리면 그 상태 문구 */
  const waitOutGateway = () =>
    waitOutGatewayScreen({
      bodyText: () => pages.current().locator("body").innerText(),
      reload: async () => void (await pages.current().reload()),
      sleep: async (ms) => void (await wait(ms)),
      log: (message) => console.log(`[farm] ${serial} ${message}`),
      relaunch: relaunchOnGateway,
    });
  /**
   * 502가 다시 불러와도 안 풀릴 때: 앱을 껐다 켜고(쌓인 창 지움) 막혔던 화면으로 딥링크로 다시 들어간다.
   * 다시 불러오기는 그 화면 하나만 새로 받아, 배포 전 코드가 남은 다른 WebView가 그대로였다.
   */
  async function relaunchOnGateway(): Promise<void> {
    let target: URL | null = null;
    try {
      target = new URL(pages.current().url());
    } catch {
      target = null;
    }
    await relaunchApp(exec, serial, appId, mainActivity);
    await wait(deepLinkRetryWaitMs);
    await reconnect();
    await allowNotificationPrompt(exec, serial, notificationAppLabel);
    pages.forget();
    if (!target || !target.href.startsWith(origin) || target.pathname === "/") return;
    const path = `${target.pathname}${target.search}`;
    await exec("adb", ["-s", serial, "shell", "am", "start", "-W", "-a", "android.intent.action.VIEW", "-d", `'${deepLinkUrl(path, app.deepLink)}'`, appId]);
    await pages.arrive(target.pathname).catch(() => undefined);
  }

  let webViewTopLeft: { x: number; y: number } | null = null;
  /** 마지막에 누른 화면 픽셀 자리(실패 기록용) */
  let lastTap = "";
  /** 개발용 칩 자리(화면 픽셀). 덤프를 뜰 때마다 새로 읽고, 칩이 안 보이는 덤프(광고 화면 등)면 앞의 것을 쓴다. 아직 못 읽었으면 null */
  let chips: ScreenBox[] | null = null;
  const readChips = (screen: string) => {
    const found = devChipBoxes(screen, devOverlay);
    if (found.length > 0 || chips === null) chips = found;
  };
  /** 누르기 전에 한 번: WebView 시작 자리와 칩 자리. 못 읽으면 다음 누르기 때 다시 */
  const readScreenFrame = async () => {
    if (webViewTopLeft && chips) return;
    const screen = await dumpScreen(exec, serial, false).catch(() => "");
    if (!screen) return;
    readChips(screen);
    if (!webViewTopLeft && webViewBoundsPattern.test(screen)) webViewTopLeft = webViewOrigin(screen);
  };
  /** 칩 자리를 지금 페이지의 CSS px로 */
  const chipsInPage = (): { left: number; top: number; right: number; bottom: number }[] => {
    const origin = webViewTopLeft;
    if (!origin || !chips) return [];
    return chips.map((box) => ({ left: box.left - origin.x, top: box.top - origin.y, right: box.right - origin.x, bottom: box.bottom - origin.y }));
  };
  /** 개발용 미리보기가 화면을 덮고 있으면 「닫기」를 누른다. 닫았으면 true */
  const closeDevPreview = async (): Promise<boolean> => {
    const screen = await dumpScreen(exec, serial, false).catch(() => "");
    readChips(screen);
    const point = devPreviewClosePoint(screen, devOverlay);
    if (!point) return false;
    console.log(`[farm] ${serial} 개발용 미리보기가 화면을 덮어 닫습니다.`);
    await exec("adb", ["-s", serial, "shell", "input", "tap", String(point.x), String(point.y)]);
    await wait(stackSettleMs);
    return true;
  };

  /**
   * 이름 규칙으로 요소를 찾아 누를 자리를 돌려준다. 찾기와 좌표 읽기를 한 번의 evaluate로 한다.
   * 따로 하면 그사이 화면이 다시 그려져 표시가 사라진다(금액 입력 키패드 등).
   * 누를 자리는 위치가 멈출 때까지 다시 재고(스크롤·전환 애니메이션·자동으로 넘어가는 캐러셀), 그 자리 맨 위 요소가 대상일 때만 돌려준다.
   * 캐러셀 슬라이드를 재는 사이 슬라이드가 넘어가 화면 밖을 누르고, 밀린 화면에서 엉뚱한 버튼을 누른 적이 있다.
   * 화면 밖이거나 가려졌으면 `blocked`에 이유를 담는다.
   */
  const locate = async (page: Page, name: string, role: ClickRole, match: ClickMatch = "exact"): Promise<TapPoint | null> => {
    await readScreenFrame();
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
      // 개발용 칩은 네이티브라 elementFromPoint에 안 잡힌다. 칩 자리(화면 픽셀)는 누르지 않는다
      const chips = ${JSON.stringify(chipsInPage())};
      const onChip = (spot) => chips.some((box) => { const x = spot.x * devicePixelRatio; const y = spot.y * devicePixelRatio; return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom; });
      const reachable = spots.filter((spot) => reaches(document.elementFromPoint(spot.x, spot.y)));
      const free = reachable.find((spot) => !onChip(spot));
      if (free) return point(free);
      if (reachable.length > 0) return { ...point(center), blocked: ${JSON.stringify(devChipBlocked)} };
      const hit = document.elementFromPoint(center.x, center.y);
      const label = hit ? hit.tagName.toLowerCase() + (typeof hit.className === "string" && hit.className ? "." + hit.className.split(/\\s+/).slice(0, 2).join(".") : "") : "없음";
      return { ...point(center), blocked: "다른 요소(" + label + ")에 가려져 있습니다" };
    })()`;
    return evaluateIn<TapPoint | null>(page, script).catch(() => null);
  };

  /**
   * 화면 좌표로 실제 탭. 하단 탭바를 네이티브가 덮는 앱은 웹 요소에 보낸 클릭(CDP)으로 탭이 안 바뀐다.
   * adb `input tap`은 사람 손가락과 같은 자리를 누른다. 링크는 세로 3/4 지점을 누른다:
   * 하단 탭은 WebView 아래 끝에 걸쳐 있어 가운데를 누르면 네이티브 탭바 경계에 닿아 안 먹을 수 있다.
   */
  const tapAt = async (point: TapPoint, forcePopupCheck: boolean, relocate?: () => Promise<TapPoint | null>) => {
    // uiautomator 덤프는 3초쯤 걸린다. WebView 위치는 한 번만, 팝업은 팝업이 덮는 화면 아래쪽을 누를 때만 본다.
    const inPopupArea = point.y > point.viewHeight * adValidatorTopRatio;
    if (!webViewTopLeft) {
      const screen = await dumpScreen(exec, serial, false);
      readChips(screen);
      webViewTopLeft = webViewOrigin(screen);
    }
    if (inPopupArea || forcePopupCheck) {
      // 팝업 확인은 보조다. `--windows` 덤프가 가끔 실패해도 누르기는 그대로 한다.
      const screen = await dumpScreen(exec, serial, true).catch(() => "");
      if (screen) readChips(screen);
      await dismissAdValidator(exec, serial, screen);
      // 덤프하는 3초 사이 화면이 움직였을 수 있다(캐러셀). 누르기 직전에 다시 잰다.
      // 다시 못 찾으면(맨 위 WebView가 바뀌는 중 등) 처음 잰 자리를 쓴다. 가려졌다고 확인된 경우에만 멈춘다.
      const fresh = relocate ? await relocate() : point;
      if (fresh?.blocked) throw new Error(`누르기 직전 위치가 바뀌었습니다: ${fresh.blocked}.`);
      if (fresh) point = fresh;
    }
    const x = Math.round(webViewTopLeft.x + point.x * point.ratio);
    const y = Math.round(webViewTopLeft.y + point.y * point.ratio);
    if (inBoxes(chips ?? [], x, y)) throw new Error(`누를 자리가 ${devChipBlocked}.`);
    await armSeenText();
    lastTap = `${x},${y}`;
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
        // 눌렀는데 안 간 것은 개발용 미리보기가 덮어서일 수 있다
        await closeDevPreview();
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
      const point = await evaluateIn<TapPoint | null>(pages.current(), reachableCloseScript(sheetCloseName)).catch(() => null);
      if (!point) return;
      await tapAt(point, false);
      await wait(stackSettleMs);
    }
  };

  /**
   * 웹 화면이 하나도 없는데 포커스는 앱 웹 화면 창(MainActivity)이면, 앱 네이티브 화면이 웹 화면을 덮은 것이다.
   * 별도 창이 아니라 leaveNativeScreens가 못 닫는다. 웹 화면이 다시 붙을 때까지 뒤로 키를 누른다.
   * 앱 밖(런처)으로 나가면 멈춘다(로그아웃 네이티브 로그인 화면일 수 있다).
   */
  /**
   * WebView 디버깅 연결을 새로 붙인다. 네이티브 화면(오퍼월)을 다녀오면 옛 연결에서 앱 페이지가 사라진 채 돌아오지 않았다.
   * 연결에 건 가드·로그 수집은 새 연결에 다시 건다(`attachContext`). 하나라도 못 걸면 새 연결을 쓰지 않는다 — 쓰기 차단 없이 버튼을 누르지 않게.
   */
  const reconnect = async (): Promise<boolean> => {
    try {
      const next = await connect(exec, serial, appId, app);
      const nextContext = next.contexts()[0];
      if (!nextContext) {
        await next.close().catch(() => undefined);
        return false;
      }
      try {
        await hooks.reattach(nextContext);
      } catch (error) {
        console.log(`[farm] ${serial} 다시 붙은 연결에 쓰기 가드·로그 수집을 못 걸어 그 연결을 쓰지 않습니다: ${error instanceof Error ? error.message : String(error)}`);
        await next.close().catch(() => undefined);
        return false;
      }
      const old = browser;
      browser = next;
      context = nextContext;
      await old.close().catch(() => undefined);
      const deadline = Date.now() + pageWaitMs;
      while (appPages(live, origin).length === 0 && Date.now() < deadline) await wait(pollMs);
      pages.forget();
      return appPages(live, origin).length > 0;
    } catch {
      return false;
    }
  };
  const leaveAppNativeRoutes = async () => {
    if (appPages(live, origin).length > 0) return;
    // 앱 안 별도 창(오퍼월 목록 등)이면 먼저 뒤로 키로 닫는다
    await leaveNativeScreens(exec, serial, appId, mainActivity, notificationAppLabel);
    // 오퍼월을 다녀오면 WebView 디버깅이 꺼질 수 있다. 앱을 다시 켜고 붙는다
    if ((await relaunchIfDevtoolsOff(exec, serial, appId, mainActivity)) && (await reconnect())) return;
    // 화면은 앱 웹인데 연결이 끊겼을 수 있다. 먼저 다시 붙어 본다
    if (await reconnect()) return;
    // 로그아웃(네이티브 로그인 화면)이면 뒤로 키 대신 카카오로 다시 로그인한다. 뒤로 키는 앱을 닫는다
    if ((await kakaoRelogin(app, exec, serial, async () => appPages(live, origin).length > 0)) === "logged-in") return;
    for (let attempt = 0; attempt < nativeBackAttempts; attempt += 1) {
      if (appPages(live, origin).length > 0) return;
      if ((await focusedWindow(exec, serial)) !== `${appId}/${mainActivity}`) return;
      await exec("adb", ["-s", serial, "shell", "input", "keyevent", "KEYCODE_BACK"]);
      const deadline = Date.now() + nativeRouteBackWaitMs;
      while (Date.now() < deadline && appPages(live, origin).length === 0) await wait(pollMs);
      if (appPages(live, origin).length === 0 && (await reconnect())) return;
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
    let deadline = Date.now() + clickWaitMs;
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
      // 같은 경로의 숨은 화면에서 찾으면 보이는 화면의 엉뚱한 자리를 누른다
      if (Date.now() < deadline && (await pages.followTwin().catch(() => false))) continue;
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
      // 못 찾거나 가려졌으면 보이지 않는 웹 화면을 읽고 있을 수 있다. 보이는 쪽으로 옮겨 다시 찾는다
      if (lastBlocked !== devChipBlocked && Date.now() < deadline && (await pages.followVisible())) continue;
      // 버튼이 없는데 화면이 게이트웨이 오류(배포 중 502)면 풀릴 때까지 다시 불러오고, 기다린 만큼 마감을 늦춘다
      if (!point) {
        const startedAt = Date.now();
        const gateway = await waitOutGateway();
        deadline += Date.now() - startedAt;
        if (gateway) throw new Error(gatewayFailureMessage(`"${name}" ${role === "link" ? "링크" : "버튼"}`, gateway));
      }
      if (Date.now() >= deadline) {
        const what = role === "link" ? "링크" : "버튼";
        const reason = lastBlocked ? `"${name}" ${role === "link" ? "링크가" : "버튼이"} ${lastBlocked}. 누르지 않았습니다.` : `"${name}" ${what}를 찾지 못했습니다.`;
        throw new Error((await pages.readingHidden().catch(() => false)) ? `${hiddenPagePrefix}${reason}` : reason);
      }
      await wait(pollMs);
    }
  };

  const resetStack = (page: Page) => (stackResetScript ? evaluateIn(page, stackResetScript).catch(() => undefined) : Promise.resolve(undefined));

  return {
    app,
    get context() {
      return context;
    },
    navigate: async (path) => {
      // 0) 앞 화면이 띄운 키보드를 내린다. 안 내리면 스택만 닫혀 키보드가 다음 화면들 스크린샷에 계속 찍힌다.
      // 1) 앞 화면 스택을 닫는다. 2) pop 직후 같은 경로 차단을 피해 기다린다. 3) 딥링크. 4) 그 화면으로.
      // 앞 화면이 앱 안 네이티브 화면(오퍼월)을 열었으면 닫고 다시 붙는다. 안 하면 뒤 화면이 전부 「웹 화면을 찾지 못했습니다」
      await leaveNativeScreens(exec, serial, appId, mainActivity, notificationAppLabel);
      await leaveAppNativeRoutes();
      await hideKeyboard(exec, serial);
      await resetStack(pages.current());
      await wait(stackSettleMs);
      // 딥링크가 안 먹으면 이 문서를 그대로 보게 된다. 표시를 남겨 "안 열림"을 알아본다.
      await evaluateIn(pages.current(), markStaleScript).catch(() => undefined);
      pages.forget();
      // adb shell은 기기 sh에 한 줄로 넘긴다. 쿼리의 &가 끊기지 않게 작은따옴표로 감싼다.
      const openLink = async () => {
        await exec("adb", ["-s", serial, "shell", "am", "start", "-W", "-a", "android.intent.action.VIEW", "-d", `'${deepLinkUrl(path, app.deepLink)}'`, appId]);
        const page = await pages.arrive(path).catch(async (error: unknown) => {
          // 배포 중 502면 도착 확인 전에 풀릴 때까지 기다린다
          if ((await waitOutGateway()) !== null) throw error;
          return pages.current();
        });
        // 다른 주소로 넘어가 열리는 화면도 있다. 앞 화면에 남긴 "안 열림" 표시가 그대로일 때만 안 열린 것이다
        if (samePath(path, pathOf(page))) return true;
        return (await evaluateIn<boolean>(page, `window.${staleMarkKey} === true`).catch(() => false)) !== true;
      };
      // 앱이 딥링크를 무시하고 지금 탭에 머물 때가 있다.
      // 한 번 더 보내고, 그래도면 앱을 다시 켜고 보낸다. 안 하면 그 화면이 「이동 실패: 앱이 …를 열지 않아」로 남는다.
      if (!(await openLink())) {
        console.log(`[farm] ${serial} 앱이 ${path} 딥링크를 열지 않아 한 번 더 보냅니다.`);
        await wait(deepLinkRetryWaitMs);
        await evaluateIn(pages.current(), markStaleScript).catch(() => undefined);
        pages.forget();
        if (!(await openLink())) {
          console.log(`[farm] ${serial} 그래도 ${path}를 열지 않아 앱을 다시 켜고 보냅니다.`);
          await relaunchApp(exec, serial, appId, mainActivity);
          await wait(deepLinkRetryWaitMs);
          await reconnect();
          await allowNotificationPrompt(exec, serial, notificationAppLabel);
          await evaluateIn(pages.current(), markStaleScript).catch(() => undefined);
          pages.forget();
          await openLink();
        }
      }
      await waitOutGateway();
    },
    attachContext: hooks.attach,
    closeDevPreview,
    clickButton,
    tapTrace: async () => {
      const top = pages.current();
      const open = appPages(live, origin).map((page) => `${page === top ? "*" : ""}${pathOf(page)}`);
      return `누른 자리 ${lastTap || "없음"} · 웹 화면 ${open.join(", ") || "없음"}`;
    },
    screenMismatch: async () => {
      const shown = screenTexts(await dumpScreen(exec, serial, false)).map(squash).filter((text) => text.length >= 2);
      const body = squash(await pages.current().locator("body").innerText({ timeout: pageWaitMs }));
      const missing = shown.filter((text) => !body.includes(text));
      return `화면에 보이는 글자 ${shown.length}개 중 읽는 웹 화면(${pathOf(pages.current())})에 없는 것 ${missing.length}개`;
    },
    relaunch: async () => {
      // 「오늘 하루 보지 않기」·배너 누른 뒤 30초 숨김 같은 기록을 지워야 앱 진입 배너가 다시 뜬다
      await Promise.all(appPages(live, origin).map((page) => evaluateIn(page, clearDismissScript).catch(() => undefined)));
      await relaunchApp(exec, serial, appId, mainActivity);
      await wait(deepLinkRetryWaitMs);
      await reconnect();
      await allowNotificationPrompt(exec, serial, notificationAppLabel);
      pages.forget();
      const deadline = Date.now() + pageWaitMs;
      while (appPages(live, origin).length === 0 && Date.now() < deadline) await wait(pollMs);
    },
    gatewayError: async () => {
      for (const page of appPages(live, origin)) {
        const gateway = gatewayErrorOf(await page.locator("body").innerText({ timeout: pageWaitMs }).catch(() => ""));
        if (gateway) return gateway;
      }
      return null;
    },
    recoverNetwork: async () => {
      const result = await reloadWebErrors(live);
      if (result.status === "recovered") pages.forget();
      return result;
    },
    tapAt: async (x, y) => {
      const ratio = await evaluateIn<{ ratio: number; viewHeight: number }>(pages.current(), "({ ratio: devicePixelRatio, viewHeight: innerHeight })");
      await tapAt({ x, y, ratio: ratio.ratio, viewHeight: ratio.viewHeight, href: null }, false);
    },
    goHome: async () => {
      // 딥링크 없이: 스택을 닫고 하단 홈 탭을 실제로 누른다. 탭바는 웹 링크다.
      // 연결 직후에는 어느 페이지가 맨 위인지 모른다. 앱 페이지 전부에 보내 스택을 확실히 닫는다.
      // 닫히는 중인 스택 화면을 맨 위로 잘못 보면 한 번 빗나간다. 그때만 한 번 더 한다.
      let lastError: unknown;
      for (let attempt = 0; attempt < homeAttempts; attempt += 1) {
        try {
          await leaveNativeScreens(exec, serial, appId, mainActivity, notificationAppLabel);
          await leaveAppNativeRoutes();
          await hideKeyboard(exec, serial);
          await Promise.all(appPages(live, origin).map(resetStack));
          await wait(stackSettleMs);
          pages.forget();
          // 화면 전체를 덮는 창(상담 채팅 메신저 iframe 등)은 스택 닫기·시트 닫기·시스템 뒤로로 안 닫힌다. 앱 설정의 닫기 스크립트를 보낸다
          if (overlayCloseScript) await Promise.all(appPages(live, origin).map((page) => evaluateIn(page, overlayCloseScript).catch(() => undefined)));
          await closeSheets();
          await clickButton(homeTabName, "link");
          return;
        } catch (error) {
          lastError = error;
          // 웹 화면이 없으면 여기서 다시 throw해 남은 시도를 못 쓴다. 다음 시도가 네이티브 화면부터 닫는다
          await leaveInPageScreen().catch(() => undefined);
        }
      }
      throw lastError;
    },
    watchAd: () =>
      watchNativeAd({
        appScreen: `${appId}/${mainActivity}`,
        focus: () => focusedWindow(exec, serial),
        dump: () => dumpScreen(exec, serial, true),
        tap: async (x, y) => void (await exec("adb", ["-s", serial, "shell", "input", "tap", String(x), String(y)])),
        back: async () => void (await exec("adb", ["-s", serial, "shell", "input", "keyevent", "KEYCODE_BACK"])),
        sleep: wait,
      }),
    expectText: async (text, timeoutMs) => {
      // 버튼이 새 WebView를 쌓으면 맨 위 페이지가 바뀐다. 매번 다시 찾는다.
      await pages.followTwin().catch(() => false);
      let deadline = Date.now() + timeoutMs;
      while (!(await hasText(text).catch(() => false)) && !(await seenSinceTap(text)) && !(await onScreen(text).catch(() => false))) {
        // 서버 게이트웨이 오류 화면(배포 중 등)이면 풀릴 때까지 다시 불러오고, 기다린 만큼 마감을 늦춘다
        const startedAt = Date.now();
        const gateway = await waitOutGateway();
        deadline += Date.now() - startedAt;
        if (gateway) throw new Error(gatewayFailureMessage(`"${text}" 문구`, gateway));
        if (Date.now() >= deadline) {
          throw new Error(`"${text}" 문구가 ${timeoutMs}ms 안에 나오지 않았습니다.`);
        }
        await wait(pollMs);
      }
    },
    currentPath: async () => pathOf(pages.current()),
    onAppSite: async () => new URL(pages.current().url()).origin === origin,
    hasText,
    screenshot: () => screencap(serial),
    evaluate: async <T>(script: string) => evaluateIn<T>(pages.current(), script),
    close: () => browser.close(),
  };
}

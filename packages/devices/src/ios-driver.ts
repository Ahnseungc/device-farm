import { setTimeout as wait } from "node:timers/promises";

import type { AppConfig } from "@device-farm/core/config/app-config";
import { deepLinkUrl } from "@device-farm/core/device/deep-link";
import { clickLabels, gatewayFailureMessage, homeAttempts, waitOutGateway as waitOutGatewayScreen, type ClickMatch, type ClickRole, type ScreenDriver } from "@device-farm/core/device/driver";
import { markStaleScript } from "@device-farm/core/device/screen-ready";

export const nativeContext = "NATIVE_APP";
const webViewPrefix = "WEBVIEW";
export const textPollMs = 250;
const contextWaitMs = 10_000;
/** 스택을 닫은 직후 같은 경로 push를 막는 앱이 있다(중복 push 방지). 그보다 조금 길게. */
export const stackSettleMs = 600;

// 줄바꿈·연속 공백은 한 칸으로 본다. 화면 문구가 <br>로 꺾여도(「정보를\n입력해 주세요」) 같은 문구다.
const hasTextScript =
  "var squash = function (v) { return String(v).replace(/\\s+/g, ' ').trim(); }; return squash(document.body && document.body.innerText || '').includes(squash(arguments[0]));";

/**
 * 버튼·링크의 역할 선택자와 이름 규칙. 누르기(clickButtonScript)와 조작 기록기(lib/record)가 같이 써서
 * 기록한 이름으로 그대로 다시 누를 수 있다. aria-label > aria-labelledby > 텍스트.
 */
export const clickTargetHelpers = `const nameOf = (el) => {
  const label = el.getAttribute("aria-label");
  if (label) return label.trim();
  const ids = (el.getAttribute("aria-labelledby") || "").split(/\\s+/).filter(Boolean);
  if (ids.length) return ids.map((id) => (document.getElementById(id) || {}).textContent || "").join(" ").trim();
  const text = (el.innerText || el.textContent || "").trim();
  if (text) return text;
  // 글자 없이 그림만 든 링크·버튼(앱 진입 배너 「이벤트 배너」)은 그림 설명(alt)이 이름이다. 글자가 있으면 alt는 안 붙인다(「채팅 채팅」)
  const img = el.querySelector("img[alt]");
  return img ? (img.getAttribute("alt") || "").trim() : "";
};
const selectors = { button: 'button, [role="button"], input[type="button"], input[type="submit"]', link: 'a[href], [role="link"]' };`;

// 역할(button·link)이고 이름이 정확히 같은 요소. aria-label > aria-labelledby > 텍스트 순으로 이름을 본다.
// Android 드라이버도 같은 스크립트를 쓴다(플로우 버튼 이름이 플랫폼마다 달라지지 않게). img alt는 글자가 없을 때만 이름이다.
export const clickButtonScript = `
// 줄바꿈·연속 공백은 한 칸으로 본다(「1일차↵오늘」). 버튼 목록(explore listActionsScript)과 같은 규칙.
const squash = (value) => String(value || "").replace(/\\s+/g, " ").trim();
const name = squash(arguments[0]);
const role = arguments[1] || "button";
const prefix = arguments[2] === "prefix";
const matches = (value) => (prefix ? value.startsWith(name) : value === name);
${clickTargetHelpers}
const candidates = document.querySelectorAll(selectors[role]);
// 같은 이름의 숨은 버튼(접힌 탭·캐러셀 복제본)을 누르지 않게 화면에 그려진 것만 본다.
const visible = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
// 같은 이름이 여럿이면 마지막(가장 위에 뜬 팝업·시트는 body 끝에 붙는다). 예: 풀팝업 「충전 취소하기」 CTA와 확인 팝업 버튼.
const found = Array.from(candidates).filter((el) => visible(el) && matches(squash(el.tagName === "INPUT" ? el.value : nameOf(el))));
// 눌리는 것(비활성이 아닌 것)을 먼저 고른다. 앞부분 맞춤 「정답」이 정답 배지가 붙은 OX 버튼(「정답 맞다」) 대신
// 아직 꺼져 있는 「정답 제출하기」를 눌러 아무 일도 없었다. 다 꺼져 있으면 전처럼 마지막 것
const enabled = found.filter((el) => !el.disabled && el.getAttribute("aria-disabled") !== "true");
const target = (enabled.length > 0 ? enabled : found).at(-1);
if (!target) return false;
target.click();
return true;
`;

function contextName(context: unknown): string | null {
  if (typeof context === "string") return context;
  if (typeof context === "object" && context !== null && "id" in context && typeof context.id === "string") return context.id;
  return null;
}

/**
 * 가장 나중에 생긴 WebView. 앱은 화면을 열 때 /web/push로 WebView를 하나 더 쌓으므로 맨 위 화면이 마지막이다.
 * except를 주면 그 목록에 없던 새 WebView가 생길 때까지 기다린다(없으면 마지막 것).
 */
async function findWebView(session: WebdriverIO.Browser, except: readonly string[] = []): Promise<string> {
  const deadline = Date.now() + contextWaitMs;
  let latest: string | undefined;
  while (Date.now() < deadline) {
    const webViews = (await session.getContexts()).map(contextName).filter((name): name is string => Boolean(name?.startsWith(webViewPrefix)));
    latest = webViews.at(-1);
    const fresh = webViews.filter((name) => !except.includes(name)).at(-1);
    if (fresh) return fresh;
    if (latest && except.length === 0) return latest;
    await wait(textPollMs);
  }
  if (latest) return latest;
  throw new Error("iOS 앱에서 WebView 컨텍스트를 찾지 못했습니다.");
}

async function webViewNames(session: WebdriverIO.Browser): Promise<string[]> {
  return (await session.getContexts()).map(contextName).filter((name): name is string => Boolean(name?.startsWith(webViewPrefix)));
}

/**
 * iOS 화면 드라이버. 화면은 주소창처럼 location을 바꾸지 않고 앱 딥링크로 연다 — 실제 사용자 진입과 같은 길이다.
 * 첫 점검에서 location 이동은 퍼널에 막히고 스택을 건너뛰어 절반 가까이가 빈 화면·다른 화면이었다.
 */
export function openIosDriver(session: WebdriverIO.Browser, appId: string, app: AppConfig): ScreenDriver {
  const { homeTabName, inPageBackNames } = app;
  // 앱 브리지로 스택을 모두 닫고 메인으로. 기다리지 않는다(그 WebView가 곧 사라진다). 설정에 없으면 하지 않는다.
  const resetStack = async () => {
    if (app.webview.stackResetScript) await session.execute(`${app.webview.stackResetScript}; return true;`).catch(() => undefined);
  };
  const isTabRoot = (path: string) => path === "/" || Object.values(app.tabPaths).includes(path);
  const inWebView = async () => {
    await session.switchContext(await findWebView(session));
  };
  /** 화면 상단 뒤로 버튼을 하나 누른다. 없으면 아무것도 안 한다. */
  const leaveInPageScreen = async () => {
    await inWebView().catch(() => undefined);
    for (const name of inPageBackNames) {
      if ((await session.execute(clickButtonScript, name, "button").catch(() => false)) === true) break;
    }
    await wait(stackSettleMs);
  };
  const hasText = async (text: string) => {
    await inWebView();
    return Boolean(await session.execute(hasTextScript, text));
  };
  /** 화면이 게이트웨이 오류(배포 중 502 등)면 풀릴 때까지 다시 불러온다. 풀리면 null */
  const waitOutGateway = () =>
    waitOutGatewayScreen({
      bodyText: async () => {
        await inWebView();
        return String(await session.execute("return document.body ? document.body.innerText : '';"));
      },
      reload: async () => {
        await inWebView();
        await session.execute("location.reload(); return true;");
      },
      sleep: async (ms) => void (await wait(ms)),
      log: (message) => console.log(`[farm] iOS ${message}`),
      relaunch: relaunchOnGateway,
    });
  /**
   * 502가 다시 불러와도 안 풀릴 때: 앱을 끄고 다시 켠 뒤 막혔던 화면으로 딥링크로 다시 들어간다(Android와 같다).
   * 다시 불러오기는 그 화면 하나만 새로 받아, 배포 전 코드가 남은 다른 WebView가 그대로였다.
   */
  async function relaunchOnGateway(): Promise<void> {
    await inWebView().catch(() => undefined);
    const path = await session
      .execute("return location.pathname + location.search;")
      .then((value) => String(value))
      .catch(() => "/");
    await session.execute("mobile: terminateApp", { bundleId: appId });
    await session.execute("mobile: activateApp", { bundleId: appId });
    await wait(stackSettleMs);
    if (path && path !== "/") await session.execute("mobile: deepLink", { url: deepLinkUrl(path, app.deepLink), bundleId: appId });
    await session.switchContext(await findWebView(session));
  }
  /** 이름으로 한 번 눌러 본다. 눌렀으면 true */
  const clickOnce = async (name: string, role: ClickRole, match: ClickMatch) => {
    await inWebView();
    for (const label of clickLabels(app, name, role)) {
      if ((await session.execute(clickButtonScript, label, role, match)) === true) return true;
    }
    return false;
  };

  return {
    app,
    navigate: async (path) => {
      // 1) 앞 화면 스택을 앱 브리지로 닫는다. 2) pop 직후 같은 경로 차단을 피해 기다린다. 3) 딥링크. 4) 새 WebView로.
      await inWebView();
      await resetStack();
      await wait(stackSettleMs);
      // 딥링크가 안 먹으면 이 문서를 그대로 보게 된다. 표시를 남겨 "안 열림"을 알아본다.
      await session.execute(`${markStaleScript}; return true;`).catch(() => undefined);
      const before = await webViewNames(session);
      await session.execute("mobile: deepLink", { url: deepLinkUrl(path, app.deepLink), bundleId: appId });
      // 탭 루트는 메인 WebView에서 열려 새 WebView가 안 생긴다. 그때는 마지막 WebView를 쓴다.
      await session.switchContext(await findWebView(session, isTabRoot(path) ? [] : before));
      // 배포 중 502면 풀릴 때까지 기다린다. 끝내 안 풀리면 그 화면 그대로 점검이 이어 가 실패로 남는다
      await waitOutGateway();
    },
    clickButton: async (name, role = "button", match = "exact") => {
      if (await clickOnce(name, role, match)) return;
      // 버튼이 없는데 화면이 게이트웨이 오류(배포 중 502)면 풀린 뒤 한 번 더 누른다
      const gateway = await waitOutGateway();
      if (gateway) throw new Error(gatewayFailureMessage(`"${name}" ${role === "link" ? "링크" : "버튼"}`, gateway));
      if (!(await clickOnce(name, role, match))) throw new Error(`"${name}" ${role === "link" ? "링크를" : "버튼을"} 찾지 못했습니다.`);
    },
    goHome: async () => {
      // Android와 같다: 열린 WebView 전부에 스택 닫기를 보내고 하단 홈 탭을 누른다. 못 찾으면 화면 상단 뒤로 버튼을 누르고 다시 한다.
      // 맨 위 WebView 하나에만 보내면 스택 화면이 남아 이후 플로우가 모두 홈에서 실패했다.
      let lastError: unknown;
      for (let attempt = 0; attempt < homeAttempts; attempt += 1) {
        try {
          for (const name of await webViewNames(session)) {
            await session.switchContext(name);
            await resetStack();
          }
          await wait(stackSettleMs);
          await session.switchContext(await findWebView(session));
          let clicked = false;
          for (const label of clickLabels(app, homeTabName, "link")) {
            clicked = (await session.execute(clickButtonScript, label, "link")) === true;
            if (clicked) break;
          }
          if (!clicked) throw new Error(`하단 「${homeTabName}」 탭을 찾지 못했습니다.`);
          return;
        } catch (error) {
          lastError = error;
          await leaveInPageScreen();
        }
      }
      throw lastError;
    },
    expectText: async (text, timeoutMs) => {
      let deadline = Date.now() + timeoutMs;
      while (!(await hasText(text))) {
        // 게이트웨이 오류 화면이면 풀릴 때까지 다시 불러오고, 기다린 만큼 마감을 늦춘다(Android와 같다)
        const startedAt = Date.now();
        const gateway = await waitOutGateway();
        deadline += Date.now() - startedAt;
        if (gateway) throw new Error(gatewayFailureMessage(`"${text}" 문구`, gateway));
        if (Date.now() >= deadline) throw new Error(`"${text}" 문구가 ${timeoutMs}ms 안에 나오지 않았습니다.`);
        await wait(textPollMs);
      }
    },
    currentPath: async () => {
      await inWebView();
      return new URL(await session.getUrl()).pathname;
    },
    hasText,
    screenshot: async () => {
      await session.switchContext(nativeContext);
      return Buffer.from(await session.takeScreenshot(), "base64");
    },
    evaluate: async <T>(script: string) => {
      await inWebView();
      return (await session.execute(`return (${script});`)) as T;
    },
    close: async () => {
      // 세션은 닫지 않는다. 사람 조작·MJPEG가 같은 세션을 계속 쓴다.
      await session.switchContext(nativeContext);
    },
  };
}

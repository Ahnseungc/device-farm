import { isLoginPath } from "../device/driver";
import type { ScreenDriver } from "../device/driver";
import type { LogRing } from "../logs/ring";
import type { LogEntry } from "../device/types";
import { decideRequest, isMutatingMethod } from "./policy";
import type { Allowlist, GuardRules } from "./policy";
import { formatNetworkLog, parseNetworkLog } from "../logs/network";

export { formatNetworkLog, parseNetworkLog };

export interface LayoutSnapshot {
  viewportWidth: number;
  viewportHeight: number;
  scrollWidth: number;
  bodyTextLength: number;
  imageCount: number;
  offscreen: Array<{ label: string; left: number; right: number }>;
  bottomFixed: Array<{ label: string; bottom: number }>;
  safeAreaBottom: number;
}

export const maxOffscreen = 20;
/** 하단 가림 허용 오차(px). 정수가 아닌 화면 배율(갤럭시 등)에서 0.4px쯤 넘는 반올림을 가림으로 보지 않는다. 화면 깨짐 점검(layout.ts)과 같은 1px */
export const bottomCoverTolerancePx = 1;

/**
 * WebView에서 평가하는 식. 바깥 변수를 쓰지 않는다.
 * offscreen은 html/body가 아닌 조상이 가로를 잘라 내는(overflow-x ≠ visible) 요소를 뺀다 — 캐러셀 슬라이드 오탐 방지.
 */
export const layoutSnapshotScript = `(() => {
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  const root = document.documentElement;
  const body = document.body;
  const isVisible = (el, rect) => {
    if (rect.width <= 0 || rect.height <= 0) return false;
    const style = getComputedStyle(el);
    return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
  };
  const isClipped = (el) => {
    for (let node = el.parentElement; node && node !== body && node !== root; node = node.parentElement) {
      if (getComputedStyle(node).overflowX !== "visible") return true;
    }
    return false;
  };
  const labelOf = (el) => {
    const name = el.getAttribute("aria-label") || (el.innerText || "").trim().slice(0, 40);
    const id = el.id ? "#" + el.id : "";
    return el.tagName.toLowerCase() + id + (name ? " " + JSON.stringify(name) : "");
  };
  const probe = document.createElement("div");
  probe.style.cssText = "position:fixed;left:0;bottom:0;width:0;height:0;visibility:hidden;padding-bottom:env(safe-area-inset-bottom);";
  body.appendChild(probe);
  const safeAreaBottom = parseFloat(getComputedStyle(probe).paddingBottom) || 0;
  probe.remove();
  const offscreen = [];
  const bottomFixed = [];
  for (const el of Array.from(body.querySelectorAll("*"))) {
    const rect = el.getBoundingClientRect();
    if (!isVisible(el, rect)) continue;
    if (offscreen.length < ${maxOffscreen} && (rect.right > vw + 1 || rect.left < -1) && !isClipped(el)) {
      offscreen.push({ label: labelOf(el), left: rect.left, right: rect.right });
    }
    const position = getComputedStyle(el).position;
    if ((position === "fixed" || position === "sticky") && rect.top > vh / 2) {
      bottomFixed.push({ label: labelOf(el), bottom: rect.bottom });
    }
  }
  return {
    viewportWidth: vw,
    viewportHeight: vh,
    scrollWidth: root.scrollWidth,
    bodyTextLength: (body.innerText || "").trim().length,
    imageCount: body.querySelectorAll("img, svg, canvas, video, picture").length,
    offscreen,
    bottomFixed,
    safeAreaBottom,
  };
})()`;

export type IssueKind =
  | "app-error"
  | "crash"
  | "console"
  | "network"
  | "blank"
  | "login-redirect"
  /** 카오스: 행동이 연달아 실패해 화면이 터치를 받지 않는 것으로 본다 */
  | "stuck"
  | "overflow"
  | "offscreen"
  | "bottom-covered"
  /** 봇 점검: 새 화면에서 잰 화면 깨짐 점검(넘침·잘림·겹침·하단 잘림) 실패 */
  | "layout";

export interface Issue {
  kind: IssueKind;
  message: string;
  /** 로그를 낸 화면 경로(로그 수집기가 알 때만). 없으면 그 단계의 화면으로 본다 */
  screen?: string;
}

export function layoutIssues(snapshot: LayoutSnapshot): Issue[] {
  const issues: Issue[] = [];
  if (snapshot.scrollWidth > snapshot.viewportWidth) {
    issues.push({ kind: "overflow", message: `가로 넘침: scrollWidth ${snapshot.scrollWidth} > ${snapshot.viewportWidth}` });
  }
  for (const item of snapshot.offscreen.slice(0, maxOffscreen)) {
    issues.push({ kind: "offscreen", message: `화면 밖 요소 ${item.label} (left ${item.left}, right ${item.right})` });
  }
  if (snapshot.bodyTextLength === 0 && snapshot.imageCount === 0) {
    issues.push({ kind: "blank", message: "빈 화면: 글자와 이미지가 없습니다." });
  }
  const limit = snapshot.viewportHeight - snapshot.safeAreaBottom;
  for (const item of snapshot.bottomFixed) {
    if (item.bottom > limit + bottomCoverTolerancePx) {
      issues.push({ kind: "bottom-covered", message: `하단 가림 ${item.label} (bottom ${item.bottom} > ${limit})` });
    }
  }
  return issues;
}

export interface NetworkEntry {
  method: string;
  status: number;
  allowedWrite: boolean;
  url: string;
}

const alwaysBadStatuses = [401, 403, 404, 405] as const;
const writeValidationStatuses = [400, 409, 422] as const;
const serverErrorMin = 500;

function includesStatus(list: readonly number[], status: number): boolean {
  return list.includes(status);
}

export function networkIssue(entry: NetworkEntry): Issue | null {
  const message = `${entry.method.toUpperCase()} ${entry.status} ${entry.url}`;
  if (entry.status >= serverErrorMin || includesStatus(alwaysBadStatuses, entry.status)) return { kind: "network", message };
  if (!includesStatus(writeValidationStatuses, entry.status)) return null;
  return entry.allowedWrite ? null : { kind: "network", message };
}

/** 수집기와 probe가 같이 쓰는 네트워크 로그 한 줄: `METHOD STATUS URL`. 실패(requestfailed)는 STATUS 0. */
function pathnameOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

function isAllowedWrite(method: string, url: string, allowlist: Allowlist | undefined, rules: GuardRules): boolean {
  if (!allowlist || !isMutatingMethod(method)) return false;
  return decideRequest(method, pathnameOf(url), allowlist, rules).allow;
}

/** 웹 주소의 사이트(`https://dev.shop.example.com` → `shop.example.com`). dev·prod 웹이 모두 이 아래에 있다고 본다 */
export function appSiteOf(webOrigin: string): string {
  const labels = new URL(webOrigin).hostname.split(".");
  return labels.length > 2 ? labels.slice(1).join(".") : labels.join(".");
}

/** 앱 사이트 요청인가. 못 읽는 주소는 앱 요청으로 본다(놓치지 않게) */
export function isAppSiteUrl(url: string, appSite: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === appSite || host.endsWith(`.${appSite}`);
  } catch {
    return true;
  }
}

/** API 호스트가 웹과 다른 사이트인 앱(`AppConfig.apiOrigin`) */
const isApiUrl = (url: string, apiOrigin: string) => {
  try {
    return apiOrigin !== "" && new URL(url).host === new URL(apiOrigin).host;
  } catch {
    return false;
  }
};

function logIssueOf(entry: LogEntry, allowlist: Allowlist | undefined, rules: GuardRules, appSite: string | undefined, apiOrigin: string): Issue | null {
  if (entry.source === "console") return { kind: "console", message: entry.text };
  if (entry.source === "crash") return { kind: "crash", message: entry.text };
  if (entry.source !== "network") return null;
  const parsed = parseNetworkLog(entry.text);
  // 형식이 다른 줄은 판단하지 않는다. 수집기는 formatNetworkLog로 남긴다.
  if (!parsed) return null;
  // 광고·CDN·분석 같은 바깥 요청의 4xx·5xx는 앱 결함이 아니다
  if (appSite && !isAppSiteUrl(parsed.url, appSite) && !isApiUrl(parsed.url, apiOrigin)) return null;
  return networkIssue({ ...parsed, allowedWrite: isAllowedWrite(parsed.method, parsed.url, allowlist, rules) });
}

function logIssue(entry: LogEntry, allowlist: Allowlist | undefined, rules: GuardRules, appSite: string | undefined, apiOrigin: string): Issue | null {
  const issue = logIssueOf(entry, allowlist, rules, appSite, apiOrigin);
  return issue && entry.page ? { ...issue, screen: entry.page } : issue;
}

async function pageIssues(driver: ScreenDriver): Promise<Issue[]> {
  const issues: Issue[] = [];
  const path = await driver.currentPath();
  const { loginPaths, appErrorText } = driver.app;
  if (isLoginPath(path, loginPaths)) issues.push({ kind: "login-redirect", message: `로그인 화면으로 이동: ${path}` });
  if (await driver.hasText(appErrorText)) issues.push({ kind: "app-error", message: appErrorText });
  const snapshot = await driver.evaluate<LayoutSnapshot>(layoutSnapshotScript);
  return [...issues, ...layoutIssues(snapshot)];
}

/**
 * 지금 화면 + since 이후 로그. allowlist가 있으면 허용한 쓰기의 400·409·422를 정상으로 본다.
 * appSite가 있으면 그 사이트 밖 요청 실패는 세지 않는다(`appSiteOf`).
 */
export async function probeScreen(
  driver: ScreenDriver,
  ring: LogRing,
  since: number,
  allowlist?: Allowlist,
  appSite?: string,
): Promise<Issue[]> {
  const screen = await pageIssues(driver);
  const logs = ring.since(since).map((entry) => logIssue(entry, allowlist, driver.app.guard, appSite, driver.app.apiOrigin));
  return [...screen, ...logs.filter((issue) => issue !== null)];
}

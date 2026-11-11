import { sleep } from "../sleep";
import type { ScreenDriver } from "../device/driver";
import { samePath } from "../device/screen-ready";
import { runRule, type QaCheck, type QaScreen, type ScreenApis } from "./rules";

/** 화면이 다 그려질 때까지 기다리는 시간 (작성자 판단, 스트리밍으로 나눠 그리는 홈 화면 기준) */
export const qaSettleMs = 4_000;
/** 페이지 안 조회 결과를 기다리는 시간·간격 (작성자 판단) */
export const qaFetchWaitMs = 15_000;
const qaPollMs = 500;
/** 실패하면 화면을 다시 열어 보는 횟수(처음 포함) (작성자 판단) */
export const qaAttempts = 2;
const resultKey = "__deviceFarmQa";

export interface QaApiResult {
  name: string;
  path: string;
  status: number;
  durationMs: number;
  /** JSON이 아니면 파싱 실패 사유 */
  error?: string;
}

export interface QaReport {
  path: string;
  name: string;
  apis: QaApiResult[];
  checks: QaCheck[];
}

type RawResult = { ok: true; list: { name: string; path: string; status: number; durationMs: number; body: string }[] } | { ok: false; error: string };

/**
 * 페이지 안에서 로그인 세션(`sessionPath`, 기본 NextAuth `/api/auth/session`)의 토큰으로 같은 GET API를 부른다. 앱이 쓰는 값과 같은 응답을 받는다.
 * 서버 컴포넌트가 미리 받은 응답은 기기 네트워크에 안 보여서 직접 다시 부른다. GET만 부른다. 토큰은 페이지 밖으로 내보내지 않는다.
 */
export function fetchScript(apiOrigin: string, apis: ScreenApis, sessionPath = "/api/auth/session"): string {
  return `(function () {
    window.${resultKey} = null;
    var apis = ${JSON.stringify(Object.entries(apis))};
    fetch(${JSON.stringify(sessionPath)}).then(function (r) { return r.json(); }).then(function (session) {
      var user = (session && session.user) || {};
      if (!user.id || !user.accessToken) throw new Error("로그인 세션이 없습니다.");
      return Promise.all(apis.map(function (entry) {
        var path = entry[1].replace("{userId}", encodeURIComponent(String(user.id)));
        var started = Date.now();
        return fetch(${JSON.stringify(apiOrigin)} + path, { method: "GET", headers: { Authorization: "Bearer " + user.accessToken }, credentials: "include" })
          .then(function (r) { return r.text().then(function (body) { return { name: entry[0], path: path.replace(String(user.id), "{userId}"), status: r.status, durationMs: Date.now() - started, body: body }; }); });
      }));
    }).then(function (list) { window.${resultKey} = { ok: true, list: list }; }, function (error) { window.${resultKey} = { ok: false, error: String(error && error.message || error) }; });
    return true;
  })()`;
}

async function fetchInPage(driver: ScreenDriver, apiOrigin: string, apis: ScreenApis, waitMs: number): Promise<RawResult> {
  await driver.evaluate(fetchScript(apiOrigin, apis, driver.app.qa.sessionPath));
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    await sleep(qaPollMs);
    const result = await driver.evaluate<RawResult | null>(`window.${resultKey}`);
    if (result) return result;
  }
  return { ok: false, error: `${waitMs / 1000}초 안에 API 응답을 받지 못했습니다.` };
}

function parseBody(body: string): { value?: unknown; error?: string } {
  try {
    return { value: JSON.parse(body) };
  } catch {
    // JSON이 아니면 규칙이 그 응답을 못 쓴다. API 결과에 사유로 남긴다.
    return { error: "JSON이 아닙니다." };
  }
}

export interface QaRunOptions {
  apiOrigin: string;
  settleMs?: number;
  fetchWaitMs?: number;
}

/**
 * 하단 탭 화면은 홈으로 가서 탭을 누른다. 딥링크로 탭 경로를 열면 앞에 쌓인 스택 화면이 남을 수 있다.
 * 나머지는 딥링크로 연다.
 */
async function openScreen(driver: ScreenDriver, path: string): Promise<void> {
  const { tabPaths, homeTabName } = driver.app;
  const tab = Object.entries(tabPaths).find(([, tabPath]) => samePath(tabPath, path));
  if (!tab || !driver.goHome) return driver.navigate(path);
  await driver.goHome();
  if (tab[0] !== homeTabName) await driver.clickButton(tab[0], "link");
}

const failedReport = (screen: QaScreen, check: QaCheck): QaReport => ({ path: screen.path, name: screen.name, apis: [], checks: [check] });

/** 열려 있는 화면에서 같은 API를 다시 불러 응답·화면 글자로 규칙을 돌린다. */
async function checkOpenScreen(driver: ScreenDriver, screen: QaScreen, apiOrigin: string, fetchWaitMs: number): Promise<QaReport> {
  const raw = await fetchInPage(driver, apiOrigin, screen.apis, fetchWaitMs);
  if (!raw.ok) return failedReport(screen, { id: "fetch", title: "API 조회", ok: false, message: raw.error });

  const responses: Record<string, unknown> = {};
  const apis = raw.list.map(({ name, path, status, durationMs, body }): QaApiResult => {
    const parsed = parseBody(body);
    if (parsed.value !== undefined && status === 200) responses[name] = parsed.value;
    return { name, path, status, durationMs, ...(parsed.error ? { error: parsed.error } : {}) };
  });
  const apiChecks: QaCheck[] = apis
    .filter((api) => api.status !== 200 || api.error)
    .map((api) => ({ id: `api-${api.name}`, title: `API ${api.path}`, ok: false, message: api.error ?? `상태 ${api.status}` }));
  const text = await driver.evaluate<string>("document.body.innerText");
  return { path: screen.path, name: screen.name, apis, checks: [...apiChecks, ...screen.rules.map((rule) => runRule(rule, { responses, text }))] };
}

/** 화면을 열고 경로가 맞는지 본다. 다른 화면 글자로 규칙을 돌리면 "값이 안 보인다"는 엉뚱한 실패가 난다. */
async function openAndSettle(driver: ScreenDriver, screen: QaScreen, settleMs: number): Promise<QaReport | null> {
  await openScreen(driver, screen.path);
  await sleep(settleMs);
  const opened = await driver.currentPath();
  return samePath(screen.path, opened) ? null : failedReport(screen, { id: "open", title: "화면 열기", ok: false, message: `${screen.path} 대신 ${opened} 화면이 열려 있습니다.` });
}

/**
 * 화면을 열고 규칙을 돌린다. 실패하면 화면을 다시 열어 한 번 더 본다.
 * 화면을 그린 뒤 다시 조회하는 몇 초 사이 실시간 값(시세 등)이 바뀌면 틀린 실패가 날 수 있다.
 */
export async function runScreenQa(driver: ScreenDriver, screen: QaScreen, options: QaRunOptions): Promise<QaReport> {
  const { apiOrigin, settleMs = qaSettleMs, fetchWaitMs = qaFetchWaitMs } = options;
  const attempt = async () => (await openAndSettle(driver, screen, settleMs)) ?? (await checkOpenScreen(driver, screen, apiOrigin, fetchWaitMs));
  let report = await attempt();
  for (let tried = 1; tried < qaAttempts && report.checks.some((check) => !check.ok); tried += 1) report = await attempt();
  return report;
}

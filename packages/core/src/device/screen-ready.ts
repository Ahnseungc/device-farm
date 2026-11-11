import { sleep as wait } from "../sleep";
import { isLoginPath, type ScreenDriver } from "./driver";

/** 화면이 그려지기를 기다리는 최대 시간, 확인 간격, 그린 뒤 더 바뀌지 않는지 보는 간격 (작성자 판단). */
export const screenReadyTimeoutMs = 15_000;
export const screenPollMs = 250;
export const screenSettleMs = 600;

export interface ScreenState {
  ready: string;
  path: string;
  text: number;
  images: number;
  /** 이동 전에 표시해 둔 그 문서 그대로면 true — 화면이 안 열렸다. */
  stale?: boolean;
}

/** 드라이버가 이동 직전에 지금 문서에 남기는 표시. 새 문서가 열리면 사라진다. */
export const staleMarkKey = "__deviceFarmStale";
export const markStaleScript = `window.${staleMarkKey} = true`;

export const screenStateScript =
  `({ ready: document.readyState, path: location.pathname, text: (document.body ? document.body.innerText : '').trim().length, images: document.images.length, stale: window.${staleMarkKey} === true })`;

export function normalizePath(path: string): string {
  const pathname = path.split(/[?#]/)[0] || "/";
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
}

export function samePath(target: string, actual: string): boolean {
  return normalizePath(target) === normalizePath(actual);
}

/**
 * 목표 경로이거나, 표시가 사라진 새 문서다. 새 문서인데 경로가 다르면 앱이 보낸 리다이렉트다
 * (완료 화면을 앞 단계 없이 열면 상위로, 로그인 상태면 홈으로). 표시가 남은 옛 문서면 아직 안 열렸다.
 */
function arrived(target: string, state: ScreenState): boolean {
  if (state.stale) return false;
  return samePath(target, state.path) || state.stale === false;
}

function painted(state: ScreenState): boolean {
  return state.ready === "complete" && (state.text > 0 || state.images > 0);
}

/** redirectedTo: 앱이 정상적으로 다른 화면으로 보냈다(`/` → 홈 경로, 첫 방문 온보딩 등). */
export type ScreenReady = { ok: true; redirectedTo?: string } | { ok: false; message: string };

export interface WaitForScreenOptions {
  timeoutMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * 이동 뒤 화면이 다 그려질 때까지 기다린다. 경로가 맞고, 문서가 끝까지 읽혔고, 글자나 이미지가 있고,
 * screenSettleMs 뒤에도 그대로여야 한다. 로그인 화면으로 튕겼으면 바로 돌려준다(판정은 checkScreen이 한다).
 * 빈 화면·다른 화면을 후보로 저장하지 않으려는 것이다(첫 실기기 점검에서 절반 가까이가 그랬다).
 */
export async function waitForScreen(driver: ScreenDriver, target: string, options: WaitForScreenOptions = {}): Promise<ScreenReady> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => wait(ms).then(() => undefined));
  const deadline = now() + (options.timeoutMs ?? screenReadyTimeoutMs);
  let last: ScreenState | null = null;
  for (;;) {
    const state = await driver.evaluate<ScreenState>(screenStateScript).catch(() => null);
    if (state && isLoginPath(state.path, driver.app.loginPaths)) return { ok: true };
    if (state && arrived(target, state) && painted(state)) {
      if (last && last.path === state.path && last.text === state.text && last.images === state.images) {
        return samePath(target, state.path) ? { ok: true } : { ok: true, redirectedTo: normalizePath(state.path) };
      }
      last = state;
      await sleep(screenSettleMs);
      continue;
    }
    last = null;
    if (now() >= deadline) return { ok: false, message: notReadyMessage(target, state, options.timeoutMs ?? screenReadyTimeoutMs) };
    await sleep(screenPollMs);
  }
}

function notReadyMessage(target: string, state: ScreenState | null, timeoutMs: number): string {
  const seconds = Math.round(timeoutMs / 1000);
  if (state?.stale) return `이동 실패: 앱이 ${target}를 열지 않아 ${state.path}에 머물렀습니다.`;
  if (state && !samePath(target, state.path)) return `이동 실패: ${target} 대신 ${state.path}에 머물렀습니다.`;
  return `${target} 화면이 ${seconds}초 안에 그려지지 않았습니다.`;
}

import { setTimeout as sleep } from "node:timers/promises";

import { screenTextsScript } from "@device-farm/core/device/button-check";
import type { ClickRole } from "@device-farm/core/device/driver";
import type { RecordEvent } from "@device-farm/core/record/recording";

import { appPages, type AndroidScreenDriver } from "./android-driver";
import { clickTargetHelpers } from "./ios-driver";

/** 페이지를 훑는 간격 (작성자 판단) */
export const recordPollMs = 500;
/** 클릭 뒤 도착 화면을 읽기까지 기다리는 시간. 버튼 눌러보기 settleMs와 같다. */
export const recordSettleMs = 1_500;

const bufferKey = "__deviceFarmRecord";

/**
 * 페이지에 클릭 리스너를 한 번 건다. 캡처 단계라 앱이 전파를 막아도 남는다.
 * 버튼·링크가 아닌 곳(배경·이미지)을 누른 것은 다시 누를 이름이 없어 남기지 않는다.
 */
export const installRecorderScript = `(() => {
  if (window.${bufferKey}) return true;
  window.${bufferKey} = [];
  ${clickTargetHelpers}
  const squash = (value) => String(value || "").replace(/\\s+/g, " ").trim();
  document.addEventListener("click", (event) => {
    const el = event.target instanceof Element ? event.target.closest(selectors.button + ", " + selectors.link) : null;
    if (!el) return;
    const role = el.matches(selectors.link) ? "link" : "button";
    const name = squash(el.tagName === "INPUT" ? el.value : nameOf(el));
    if (name) window.${bufferKey}.push({ at: Date.now(), path: location.pathname, role, name });
  }, true);
  return true;
})()`;

const drainScript = `(window.${bufferKey} || []).splice(0)`;

type RawClick = { at: number; path: string; role: ClickRole; name: string };

export interface Recorder {
  /** 기록 시작 화면 경로 */
  startPath: string;
  /** 지금까지 모은 이벤트 수(진행 표시용) */
  count: () => number;
  stop: () => Promise<RecordEvent[]>;
}

/**
 * 앱 페이지 전부에서 클릭을 모은다. 스택 화면은 WebView가 따로라, 누른 페이지가 아니라 앞에 새로 뜬 페이지가 도착 화면이다.
 * 그래서 지금 화면은 드라이버(페이지 추적기)로 읽고, 클릭은 모든 페이지에서 꺼낸다.
 */
export async function startRecorder(driver: AndroidScreenDriver, origin: string, now: () => number = Date.now): Promise<Recorder> {
  const startPath = await driver.currentPath();
  const events: RecordEvent[] = [];
  const pending: RawClick[] = [];
  let lastPath = startPath;
  let stopped = false;

  const drainAll = async () => {
    for (const page of appPages(driver.context, origin)) {
      await page.evaluate(installRecorderScript).catch(() => undefined);
      const clicks = await page.evaluate<RawClick[]>(drainScript).catch(() => []);
      pending.push(...clicks);
    }
    pending.sort((a, b) => a.at - b.at);
  };

  const settle = async () => {
    const click = pending[0];
    if (!click || now() - click.at < recordSettleMs) return false;
    pending.shift();
    const to = await driver.currentPath().catch(() => lastPath);
    const texts = await driver.evaluate<string[]>(screenTextsScript).catch(() => []);
    events.push({ type: "click", at: click.at, from: click.path, role: click.role, name: click.name, to, texts });
    lastPath = to;
    return true;
  };

  const tick = async () => {
    await drainAll();
    if (await settle()) return;
    if (pending.length > 0) return;
    // 클릭 없이 화면이 바뀌었다(뒤로 키·리다이렉트). 네이티브 화면이면 경로를 못 읽어 그대로 둔다.
    const path = await driver.currentPath().catch(() => lastPath);
    if (path !== lastPath) events.push({ type: "jump", at: now(), from: lastPath, to: path });
    lastPath = path;
  };

  const loop = (async () => {
    while (!stopped) {
      await tick().catch(() => undefined);
      await sleep(recordPollMs);
    }
  })();

  return {
    startPath,
    count: () => events.length,
    stop: async () => {
      stopped = true;
      await loop;
      // 멈추기 직전 클릭도 도착 화면을 읽고 끝낸다.
      await drainAll().catch(() => undefined);
      while (pending.length > 0) {
        const wait = recordSettleMs - (now() - pending[0].at);
        if (wait > 0) await sleep(wait);
        await settle().catch(() => pending.shift());
      }
      return events;
    },
  };
}

import type { AdWatch } from "@device-farm/core/device/driver";

/** 광고 버튼을 누른 뒤 광고 화면이 뜨기를 기다리는 시간 (작성자 판단). 광고를 받아 오는 데 몇 초 걸린다 */
export const adAppearMs = 15_000;
/** 광고를 끝까지 보는 최대 시간 (작성자 판단). 보상형 광고는 15~30초, 끝나면 닫기가 나온다 */
export const adMaxWatchMs = 90_000;
/** 광고 화면을 다시 보는 간격 */
export const adPollMs = 2_000;

/**
 * 광고 화면에서 누를 닫기. text·content-desc가 이것이면 닫기다(대소문자 무시).
 * 「설치」「자세히 알아보기」 같은 광고 버튼은 누르지 않는다.
 */
export const adCloseNames = ["close", "close ad", "닫기", "광고 닫기", "skip", "skip ad", "건너뛰기", "x", "×", "interstitial close button"] as const;
/** 보상형 광고를 일찍 닫으려 하면 「동영상을 닫을까요? 보상을 잃습니다」가 뜬다. 보상을 잃지 않게 계속 본다 */
export const adResumeNames = ["resume video", "계속 시청", "동영상 계속 보기", "계속 보기", "resume"] as const;

export interface AdScreenDeps {
  /** 지금 포커스된 창 `<package>/<activity>`. 못 읽으면 "" */
  focus: () => Promise<string>;
  /** 모든 창 uiautomator 덤프(XML) */
  dump: () => Promise<string>;
  tap: (x: number, y: number) => Promise<void>;
  back: () => Promise<void>;
  sleep: (ms: number) => Promise<void>;
  now?: () => number;
  /** 앱 웹 화면 `<appId>/com.example.app.MainActivity` */
  appScreen: string;
}

export interface AdWatchTimes {
  appearMs?: number;
  maxWatchMs?: number;
  pollMs?: number;
}

type Node = { name: string; x: number; y: number };

/** 덤프에서 text·content-desc가 names 중 하나인 노드의 가운데 */
export function findAdButton(dump: string, names: readonly string[]): Node | null {
  for (const match of dump.matchAll(/<node [^>]*>/g)) {
    const node = match[0];
    const label = [/ text="([^"]*)"/.exec(node)?.[1], / content-desc="([^"]*)"/.exec(node)?.[1]].map((value) => (value ?? "").trim()).find((value) => names.includes(value.toLowerCase()));
    const resourceClose = / resource-id="[^"]*close[^"]*"/i.test(node);
    if (!label && !(resourceClose && names === adCloseNames)) continue;
    const bounds = /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(node);
    if (!bounds) continue;
    const [left, top, right, bottom] = bounds.slice(1).map(Number);
    if (right <= left || bottom <= top) continue;
    return { name: label || "닫기", x: Math.round((left + right) / 2), y: Math.round((top + bottom) / 2) };
  }
  return null;
}

/**
 * 광고 버튼을 누른 뒤: 광고 화면(앱 웹 화면이 아닌 창)이 뜨면 끝까지 보고, 닫기가 나오면 눌러 앱으로 돌아온다.
 * 끝내 닫기가 안 나오면 뒤로 키를 한 번 누르고, 그래도 안 닫히면 실패.
 */
export async function watchNativeAd(deps: AdScreenDeps, times: AdWatchTimes = {}): Promise<AdWatch> {
  const { appearMs = adAppearMs, maxWatchMs = adMaxWatchMs, pollMs = adPollMs } = times;
  const now = deps.now ?? Date.now;
  const onAd = (focus: string) => focus !== "" && focus !== deps.appScreen;

  const appearDeadline = now() + appearMs;
  let focus = await deps.focus();
  while (!onAd(focus)) {
    if (now() >= appearDeadline) return { shown: false };
    await deps.sleep(pollMs);
    focus = await deps.focus();
  }

  const started = now();
  const seconds = () => Math.round((now() - started) / 1000);
  let closedBy = "광고가 끝나 스스로 닫힘";
  while (now() - started < maxWatchMs) {
    await deps.sleep(pollMs);
    if (!onAd(await deps.focus())) return { shown: true, seconds: seconds(), closedBy };
    const dump = await deps.dump().catch(() => "");
    const resume = findAdButton(dump, adResumeNames);
    if (resume) {
      await deps.tap(resume.x, resume.y);
      continue;
    }
    const close = findAdButton(dump, adCloseNames);
    if (close) {
      await deps.tap(close.x, close.y);
      closedBy = `「${close.name}」를 눌러 닫음`;
    }
  }
  await deps.back();
  await deps.sleep(pollMs);
  if (!onAd(await deps.focus())) return { shown: true, seconds: seconds(), closedBy: "닫기가 안 나와 뒤로 가기로 닫음" };
  throw new Error(`광고가 ${Math.round(maxWatchMs / 1000)}초 안에 닫히지 않았습니다(${focus}).`);
}

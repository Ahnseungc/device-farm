import assert from "node:assert/strict";

import { adCloseNames, findAdButton, watchNativeAd, type AdScreenDeps } from "./ad-watch";

const app = "com.example.shop.dev/com.example.shop.MainActivity";
const ad = "com.example.shop.dev/com.google.android.gms.ads.AdActivity";
const node = (attrs: string, bounds: string) => `<node index="0" ${attrs} bounds="${bounds}" />`;
const closeDump = `<hierarchy>${node('text="Install" content-desc=""', "[100,2000][980,2100]")}${node('text="" content-desc="Close"', "[960,80][1060,180]")}</hierarchy>`;

// 닫기 찾기: 「Install」 같은 광고 버튼은 고르지 않고 Close의 가운데
assert.deepEqual(findAdButton(closeDump, adCloseNames), { name: "Close", x: 1010, y: 130 });
assert.equal(findAdButton(node('text="Install"', "[0,0][10,10]"), adCloseNames), null);

/** 가짜 기기: focus 순서대로, 덤프 순서대로. 시간은 sleep만큼 흐른다 */
function fake(focuses: string[], dumps: string[]): AdScreenDeps & { calls: string[] } {
  let clock = 0;
  let focusIndex = 0;
  let dumpIndex = 0;
  const calls: string[] = [];
  return {
    calls,
    appScreen: app,
    now: () => clock,
    sleep: async (ms) => void (clock += ms),
    focus: async () => focuses[Math.min(focusIndex++, focuses.length - 1)],
    dump: async () => dumps[Math.min(dumpIndex++, dumps.length - 1)],
    tap: async (x, y) => void calls.push(`tap ${x},${y}`),
    back: async () => void calls.push("back"),
  };
}

// 광고가 뜨고, 닫기가 나오면 눌러 앱으로 돌아온다
{
  const deps = fake([app, ad, ad, ad, app], ["<hierarchy/>", closeDump]);
  const result = await watchNativeAd(deps, { appearMs: 10_000, maxWatchMs: 60_000, pollMs: 2_000 });
  assert.deepEqual(result, { shown: true, seconds: 6, closedBy: "「Close」를 눌러 닫음" });
  assert.deepEqual(deps.calls, ["tap 1010,130"]);
}

// 「동영상을 닫을까요?」가 뜨면 보상을 잃지 않게 계속 본다
{
  const resume = `<hierarchy>${node('text="CLOSE VIDEO"', "[100,1000][500,1100]")}${node('text="RESUME VIDEO"', "[600,1000][1000,1100]")}</hierarchy>`;
  const deps = fake([ad, ad, ad, app], [resume, closeDump]);
  await watchNativeAd(deps, { pollMs: 1_000 });
  assert.deepEqual(deps.calls, ["tap 800,1050", "tap 1010,130"]);
}

// 광고 화면이 끝내 안 뜨면 shown false (적립은 부른 쪽이 잔액으로 본다)
assert.deepEqual(await watchNativeAd(fake([app], []), { appearMs: 5_000, pollMs: 1_000 }), { shown: false });

// 닫기가 끝내 안 나오면 뒤로 가기, 그래도 안 닫히면 실패
{
  const deps = fake([ad, ad, ad, ad, ad, app], ["<hierarchy/>"]);
  const result = await watchNativeAd(deps, { maxWatchMs: 4_000, pollMs: 1_000 });
  assert.deepEqual(result, { shown: true, seconds: 5, closedBy: "닫기가 안 나와 뒤로 가기로 닫음" });
  assert.deepEqual(deps.calls, ["back"]);
  await assert.rejects(watchNativeAd(fake([ad], ["<hierarchy/>"]), { maxWatchMs: 3_000, pollMs: 1_000 }), /광고가 3초 안에 닫히지 않았습니다/);
}

console.log("ad watch ok");

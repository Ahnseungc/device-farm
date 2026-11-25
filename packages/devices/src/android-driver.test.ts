import assert from "node:assert/strict";

import { defaultForbiddenButtonWords } from "@device-farm/core/config/app-config";

import { hasForbiddenWord } from "@device-farm/core/explore/actions";

import { armSeenTextScript, clearDismissPattern, clearDismissScript, createPageTracker, foreignAppInFront, isAppNativeScreen, relaunchIfDevtoolsOff, screenTexts } from "./android-driver";

const appId = "com.example.shop.dev";
const mainActivity = "com.example.shop.MainActivity";
const focus = (component: string) => `  mCurrentFocus=Window{f267137 u0 ${component}}\n`;

// 앱 안 네이티브 화면(오퍼월 등)이면 뒤로 키로 닫는다
assert.equal(isAppNativeScreen(focus(`${appId}/com.example.offerwall.ListActivity`), appId, mainActivity), true);
// 메인 화면(WebView)·다른 앱·읽기 실패는 건드리지 않는다
assert.equal(isAppNativeScreen(focus(`${appId}/${mainActivity}`), appId, mainActivity), false);
assert.equal(isAppNativeScreen(focus("com.example.messenger/com.example.messenger.SplashActivity"), appId, mainActivity), false);
assert.equal(isAppNativeScreen("", appId, mainActivity), false);

// 다른 앱(Play 스토어)이 앞이면 앱을 앞으로 불러온다. 앱·권한 창·읽기 실패는 아니다
{
  const front = (dump: string) => foreignAppInFront(async () => dump, "S", appId);
  assert.equal(await front(focus("com.android.vending/com.google.android.finsky.pageframework.overlayactivity.PageControllerOverlayActivity")), true);
  assert.equal(await front(focus(`${appId}/com.example.shop.MainActivity`)), false);
  assert.equal(await front(focus("com.google.android.permissioncontroller/com.android.permissioncontroller.permission.ui.GrantPermissionsActivity")), false);
  assert.equal(await front(""), false);
}

// 오퍼월을 다녀와 WebView 디버깅 소켓이 사라지면 앱을 다시 켠다. 소켓이 있거나, 앱 메인 화면이 아니거나, 앱이 안 떠 있으면 켜지 않는다
{
  const fake = (state: { pid: string; sockets: string; focus: string }) => {
    const calls: string[] = [];
    const exec = async (_cmd: string, args: readonly string[]) => {
      const command = args.slice(2).join(" ");
      if (command.startsWith("shell pidof")) return state.pid;
      if (command === "shell cat /proc/net/unix") return state.sockets;
      if (command === "shell dumpsys window") return focus(state.focus);
      calls.push(command);
      return "";
    };
    return { exec, calls };
  };
  const mainActivity = "com.example.shop.MainActivity";
  const main = `${appId}/${mainActivity}`;
  const off = fake({ pid: "30951", sockets: "", focus: main });
  assert.equal(await relaunchIfDevtoolsOff(off.exec, "s", appId, mainActivity), true);
  assert.ok(off.calls.some((call) => call.includes("force-stop")));
  assert.equal(await relaunchIfDevtoolsOff(fake({ pid: "30951", sockets: "@webview_devtools_remote_30951", focus: main }).exec, "s", appId, mainActivity), false);
  assert.equal(await relaunchIfDevtoolsOff(fake({ pid: "30951", sockets: "", focus: `${appId}/com.ads.offerwall.ListActivity` }).exec, "s", appId, mainActivity), false);
  // 메인 액티비티를 모르면 다시 켜지 않는다
  assert.equal(await relaunchIfDevtoolsOff(fake({ pid: "30951", sockets: "", focus: main }).exec, "s", appId, undefined), false);
  assert.equal(await relaunchIfDevtoolsOff(fake({ pid: "", sockets: "", focus: main }).exec, "s", appId, mainActivity), false);
}

// 화면 글자(접근성 트리): text·content-desc를 모으고 빈 값은 뺀다. 돌아온 화면의 토스트를 이것으로 본다
assert.deepEqual(
  screenTexts('<node text="포인트 충전을 취소했어요." content-desc="" /><node text="" content-desc="자산 리포트" /><node text="A &amp; B &quot;C&quot;" />'),
  ["포인트 충전을 취소했어요.", "자산 리포트", 'A & B "C"'],
);

// 누르기 직전 기록기는 페이지에서 그대로 도는 JS여야 한다
assert.doesNotThrow(() => new Function(`return ${armSeenTextScript}`));

// 앱 다시 켜기 전에 지우는 기록: 다시 보지 않기·잠깐 숨김만. 로그인·세션은 건드리지 않는다
for (const name of ["shop_app_entry_notice_dismissed", "shop_app_entry_notice_temp_hide", "shop_landing_dismissed_1122"]) assert.ok(clearDismissPattern.test(name), name);
for (const name of ["accessToken", "next-auth.session-token", "shop_app_entry_notice_seen_banner"]) assert.ok(!clearDismissPattern.test(name), name);
assert.doesNotThrow(() => new Function(`return ${clearDismissScript}`));

// 기기에 저장돼 다음 점검을 바꾸는 「보지 않기」류는 누르지 않는다
for (const name of ["다시 보지 않기", "오늘 하루 보지 않기", "다시 보지않기", "오늘 그만 보기"]) assert.ok(hasForbiddenWord(name, defaultForbiddenButtonWords), name);
assert.ok(!hasForbiddenWord("닫기", defaultForbiddenButtonWords));

// 같은 경로의 웹 화면이 둘이면 화면에 그려지는 쪽을 읽는다
{
  const origin = "https://dev.example.com";
  const page = (path: string, frames: number) => ({ isClosed: () => false, url: () => `${origin}${path}`, evaluate: async (script: unknown) => (String(script).includes("requestAnimationFrame") ? frames : true) });
  type Fake = ReturnType<typeof page>;
  const tracker = (list: Fake[]) => createPageTracker({ pages: () => list } as never, origin);
  const hidden = page("/sell", 0);
  const shown = page("/sell", 20);
  assert.equal(await tracker([hidden, shown]).arrive("/sell", 50), shown as never);
  // 하나뿐이면 재지 않고 그것
  assert.equal(await tracker([hidden]).arrive("/sell", 50), hidden as never);

  // 읽던 화면이 숨었고 그려지는 화면이 하나면 옮긴다
  const list = [hidden, shown];
  const two = createPageTracker({ pages: () => list } as never, origin);
  assert.equal(await two.followVisible(), true);
  assert.equal(two.current(), shown as never);
  assert.equal(await two.followVisible(), false);
  assert.equal(await two.readingHidden(), false);

  // 숨은 쪽에서 버튼을 멀쩡히 찾을 수 있으니, 같은 경로가 둘이면 찾기 전에 그려지는 쪽으로 옮긴다
  const twinHidden = page("/my", 0);
  const twinShown = page("/my", 20);
  const twinPages = [twinShown, twinHidden];
  const twins = createPageTracker({ pages: () => twinPages } as never, origin);
  assert.equal(twins.current(), twinHidden as never);
  assert.equal(await twins.followTwin(), true);
  assert.equal(twins.current(), twinShown as never);
  assert.equal(await twins.followTwin(), false);
  // 경로가 다르면 다른 화면이 그려져도 옮기지 않는다(버튼이 쌓은 화면은 current가 고른다)
  const apart = [page("/benefit", 20), page("/my", 0)];
  assert.equal(await createPageTracker({ pages: () => apart } as never, origin).followTwin(), false);

  // 탭을 막 눌러 둘 다 안 그려지면 그려질 때까지 기다린다. 끝내 안 그려지면 첫 번째
  let painted = 0;
  const late = { ...page("/my", 0), evaluate: async (script: unknown) => (String(script).includes("requestAnimationFrame") ? ((painted += 1) > 1 ? 20 : 0) : true) };
  const openingPages = [page("/my", 0), late];
  const opening = createPageTracker({ pages: () => openingPages } as never, origin);
  assert.equal(await opening.arrive("/my", 3_000), late as never);
  const never = [page("/my", 0), page("/my", 0)];
  assert.equal(await createPageTracker({ pages: () => never } as never, origin).arrive("/my", 10), never[0] as never);

  // 그려지는 화면이 둘이면 옮기지 않는다
  const both = createPageTracker({ pages: () => [shown, page("/my", 20)] } as never, origin);
  assert.equal(await both.followVisible(), false);
  // 아무것도 안 그려지면(네이티브 광고 화면) 옮기지 않는다
  const none = createPageTracker({ pages: () => [hidden, page("/my", 0)] } as never, origin);
  assert.equal(await none.followVisible(), false);
  assert.equal(await none.readingHidden(), false);
}

console.log("android-driver ok");

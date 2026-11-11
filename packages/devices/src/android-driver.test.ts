import assert from "node:assert/strict";

import { isAppNativeScreen } from "./android-driver";

const appId = "com.example.shop.dev";
const mainActivity = "com.example.shop.MainActivity";
const focus = (component: string) => `  mCurrentFocus=Window{f267137 u0 ${component}}\n`;

// 앱 안 네이티브 화면(오퍼월 등)이면 뒤로 키로 닫는다
assert.equal(isAppNativeScreen(focus(`${appId}/com.example.offerwall.ListActivity`), appId, mainActivity), true);
// 메인 화면(WebView)·다른 앱·읽기 실패는 건드리지 않는다
assert.equal(isAppNativeScreen(focus(`${appId}/${mainActivity}`), appId, mainActivity), false);
assert.equal(isAppNativeScreen(focus("com.example.messenger/com.example.messenger.SplashActivity"), appId, mainActivity), false);
assert.equal(isAppNativeScreen("", appId, mainActivity), false);

console.log("android-driver ok");

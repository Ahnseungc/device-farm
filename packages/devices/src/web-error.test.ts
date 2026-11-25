import assert from "node:assert/strict";

import type { BrowserContext, Page } from "playwright";

import { evaluateIn, reloadWebErrors, webErrorPages } from "./android-driver";

/** 오류 화면 페이지 흉내. reload 몇 번 뒤 앱 주소로 돌아온다 */
function fakePage(url: string, fixAfter: number): Page {
  let reloads = 0;
  let current = url;
  return {
    isClosed: () => false,
    url: () => current,
    locator: () => ({ innerText: async () => "웹페이지를 사용할 수 없음\nnet::ERR_CONNECTION_TIMED_OUT" }),
    reload: async () => {
      reloads += 1;
      if (reloads >= fixAfter) current = "https://dev.example/benefit";
      return null;
    },
  } as unknown as Page;
}
const contextOf = (pages: Page[]) => ({ pages: () => pages }) as Pick<BrowserContext, "pages">;
const pause = async () => undefined;

assert.deepEqual(await reloadWebErrors(contextOf([fakePage("https://dev.example/", 1)]), [1], pause), { status: "none" });
assert.deepEqual(await reloadWebErrors(contextOf([fakePage("chrome-error://chromewebdata/", 2)]), [1, 1, 1], pause), { status: "recovered", code: "net::ERR_CONNECTION_TIMED_OUT" });
assert.deepEqual(await reloadWebErrors(contextOf([fakePage("chrome-error://chromewebdata/", 9)]), [1, 1], pause), { status: "failed", code: "net::ERR_CONNECTION_TIMED_OUT" });
assert.equal(webErrorPages(contextOf([fakePage("chrome-error://chromewebdata/", 1), fakePage("https://dev.example/", 1)])).length, 1);

// 멈춘 WebView: evaluate가 답하지 않으면 시간 제한 뒤 실패한다(끝없이 기다리지 않는다)
await assert.rejects(evaluateIn({ evaluate: () => new Promise(() => undefined) } as unknown as Page, "1", 30), /웹 화면이 0초 안에 답하지 않았습니다/);
assert.equal(await evaluateIn<number>({ evaluate: async () => 7 } as unknown as Page, "7", 30), 7);

console.log("web error ok");


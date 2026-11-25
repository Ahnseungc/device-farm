import assert from "node:assert/strict";

import { chromium } from "playwright";

import { popupCloseSteps, popupScript, type PopupInfo } from "@device-farm/core/device/popup";

/**
 * 팝업 찾기 스크립트를 진짜 브라우저(로컬 Playwright Chromium)에서 앱과 같은 구조로 돌려 본다.
 * Playwright 브라우저가 없으면 설치된 Chrome으로, 그것도 없으면 건너뛴다.
 */
const page = `<!doctype html><meta name=viewport content="width=411">
<style>body{margin:0;font:16px sans-serif}.fixed{position:fixed}.absolute{position:absolute}.relative{position:relative}.inset-0{inset:0}
main{height:1700px}.tabs{position:fixed;left:0;right:0;bottom:0;height:60px;background:#fff;z-index:10;display:flex}
.bg-bg-dim{background:rgba(0,0,0,.5)}.center{display:flex;align-items:center;justify-content:center}</style>
<main><h1>0.103068g</h1><button>참여하기</button></main>
<nav class=tabs><a href=/benefit>혜택</a><a href=/my>MY</a></nav>`;

/** 「적립 단위 변경 안내」: 딤 위에 투명한 화면 전체 상자가 있고 그 가운데 카드, 버튼은 「이동」 하나 */
const centered = `<div class="fixed inset-0" style="z-index:50"><div class="bg-bg-dim absolute inset-0"></div>
<div class="absolute inset-0 center"><div class="relative" style="width:340px;background:#fff;padding:20px">
<h2>적립 단위 변경 안내</h2><p>적립 단위가 바뀌었어요.</p><button>이동</button></div></div></div>`;

/** 같은 안내의 실제 구조: 팝업 층 class에 \`z-overlay\`가 들어 층 자체도 딤처럼 보인다. 카드는 층 바로 아래 */
const overlayLayer = `<div class="z-overlay fixed inset-0" style="z-index:50;display:flex;align-items:center;justify-content:center;top:-120px;bottom:-120px">
<div class="bg-bg-dim absolute inset-0"></div><div class="relative" style="width:340px;background:#fff;padding:20px">
<h2>적립 단위 변경 안내</h2><p>적립 단위가 바뀌었어요.</p><button>이동</button></div></div>`;

/** 혜택 주관식 퀴즈 시트: 딤 이름이 없다(\`absolute inset-0 bg-black\` 투명도 0.4). 층은 \`z-overlay\` */
const quizSheet = `<div class="z-overlay fixed inset-0" style="z-index:50;display:flex;align-items:flex-end;justify-content:center">
<div class="absolute inset-0" style="background:rgb(33,33,33);opacity:.4"></div>
<div class="relative" style="width:100%;height:520px;background:#fff"><button aria-label="닫기">X</button>
<p>시험에 붙기를 바란다는 뜻의 빈칸 말은 무엇인가요?</p><button>광고 보고 정답 확인하기</button><button>입력하기</button></div></div>`;

/** 딤을 따로 못 찾고 층만 딤으로 보일 때(딤이 투명하게 바뀐 경우): 층 바로 아래 카드를 본체로 */
const layerOnly = `<div class="z-overlay fixed inset-0" style="z-index:50;display:flex;align-items:center;justify-content:center">
<div class="relative" style="width:340px;background:#fff;padding:20px"><h2>아쉽게도 시간이 초과됐어요</h2><button>다시 풀기</button></div></div>`;

/** 쇼핑 「이벤트 한정 판매」 바텀시트: 딤 + 아래 시트, 닫기·CTA·다시 보지 않기 */
const sheet = `<div class="fixed inset-0" style="z-index:50"><div class="bg-bg-dim absolute inset-0"></div>
<div class="absolute" style="left:0;right:0;bottom:0;height:450px;background:#fff"><button aria-label="닫기">X</button>
<h2>이벤트 한정 판매</h2><button>쇼핑 둘러보기</button><button>다시 보지 않기</button></div></div>`;

/** 「마케팅 활용 동의서」 풀팝업: 흰 배경 전체 화면 dialog, class에 \`z-overlay\`. 우상단 X(닫기)·하단 「확인」 */
const fullTerms = (buttons: string) => `<div role="dialog" aria-modal="true" aria-label="마케팅 활용 동의서" class="z-overlay-content-priority fixed inset-0" style="z-index:60;background:#fff;display:flex;flex-direction:column">
<header style="height:56px"><span>마케팅 활용 동의서</span>${buttons.includes("X") ? `<button aria-label="닫기">X</button>` : ""}</header>
<div style="flex:1;overflow-y:auto"><h2>후기·리뷰 콘텐츠 마케팅 활용 동의서</h2><section style="height:300px"><h3>활용 대상 콘텐츠</h3></section>
<section style="height:300px"><h3>활용 목적</h3><p>앱 내 후기 노출</p></section><section style="height:300px"><h3>활용 방식</h3></section></div>
<footer style="height:80px">${buttons.includes("확인") ? "<button>확인</button>" : ""}</footer></div>`;

let browser;
try {
  browser = await chromium.launch().catch(() => chromium.launch({ channel: "chrome" }));
} catch {
  console.log("popup script skipped (Chromium·Chrome 없음)");
  process.exit(0);
}
try {
  const tab = await browser.newPage({ viewport: { width: 411, height: 836 } });
  const detect = async (html: string) => {
    await tab.setContent(page + html);
    return tab.evaluate<PopupInfo | null>(popupScript);
  };

  assert.equal(await detect(""), null, "팝업이 없으면 null");

  const notice = await detect(centered);
  assert.ok(notice);
  assert.equal(notice.title, "적립 단위 변경 안내");
  assert.deepEqual(notice.buttons, [{ name: "이동", reachable: true }]);
  assert.ok(notice.dim, "딤 누를 자리");
  assert.deepEqual(popupCloseSteps(notice), [{ kind: "dim" }, { kind: "press", name: "이동" }]);

  const layered = await detect(overlayLayer);
  assert.ok(layered, "z-overlay 층 안 딤 + 카드");
  assert.equal(layered.title, "적립 단위 변경 안내");
  assert.deepEqual(popupCloseSteps(layered), [{ kind: "dim" }, { kind: "press", name: "이동" }]);

  const quiz = await detect(quizSheet);
  assert.ok(quiz, "이름 없는 딤 + 시트");
  assert.equal(quiz.title, "시험에 붙기를 바란다는 뜻의 빈칸 말은 무엇인가요?");
  assert.ok(quiz.dim, "딤 누를 자리");
  assert.deepEqual(popupCloseSteps(quiz)[0], { kind: "button", name: "닫기" });

  const timeout = await detect(layerOnly);
  assert.ok(timeout, "층만 딤으로 보여도 카드를 찾음");
  assert.equal(timeout.title, "아쉽게도 시간이 초과됐어요");

  assert.equal(await detect(`<div class="fixed inset-0" style="background:rgb(20,20,20)"><p>검은 배경 화면</p></div>`), null, "글자가 든 어두운 화면은 딤이 아님");

  const shop = await detect(sheet);
  assert.ok(shop);
  assert.equal(shop.title, "이벤트 한정 판매");
  assert.deepEqual(shop.buttons.map((button) => button.name), ["닫기", "쇼핑 둘러보기", "다시 보지 않기"]);
  assert.deepEqual(popupCloseSteps(shop)[0], { kind: "button", name: "닫기" });

  // 전체 화면 팝업은 팝업 전체가 본체, 바깥 딤 없음 → X·「확인」으로 닫는다(오탐 「팝업 · 활용 목적」)
  const terms = await detect(fullTerms("X 확인"));
  assert.ok(terms, "전체 화면 dialog");
  assert.equal(terms.title, "마케팅 활용 동의서");
  assert.equal(terms.dim, null);
  assert.deepEqual(popupCloseSteps(terms), [{ kind: "button", name: "닫기" }, { kind: "button", name: "확인" }]);
  // 닫을 버튼이 없는 전체 화면 팝업은 여전히 닫지 못함(앱 오류로 남는다)
  const stuck = await detect(fullTerms(""));
  assert.ok(stuck);
  assert.equal(stuck.dim, null);
  assert.deepEqual(popupCloseSteps(stuck), []);
} finally {
  await browser.close();
}
console.log("popup script ok");

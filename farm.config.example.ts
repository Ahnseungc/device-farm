/**
 * 앱 설정 예시: 가상의 쇼핑 앱 「Sample Shop」.
 * 이 파일을 `farm.config.ts`로 복사해 내 앱 값으로 바꾼다(`farm.config.ts`는 커밋하지 않는다).
 * `farm.config.ts`가 없으면 디바이스팜은 이 예시로 시작한다(기기 점검은 실제 앱이 있어야 돈다).
 *
 * 디바이스팜 저장소 밖(내 프로젝트)에 두고 `@device-farm/core`를 못 불러온다면
 * `import type { AppConfigInput } ...` + `export default { ... } satisfies AppConfigInput` 형태로 써도 된다.
 */
import { defineAppConfig } from "@device-farm/core/config/app-config";
import { equalWon, formatWon, numberAt, textHas } from "@device-farm/core/qa/rules";

export default defineAppConfig({
  name: "Sample Shop",
  // 디바이스팜 화면 언어 "ko"(기본)·"en". FARM_LOCALE 환경 변수가 이긴다.
  locale: "ko",
  // Android 패키지 = iOS 번들 id. 다르면 iosBundleIds로 덮는다.
  appIds: { dev: "com.example.shop.dev", prod: "com.example.shop" },
  // 앱 WebView가 여는 웹 주소. 비우면 .env의 FARM_WEB_ORIGIN_DEV·FARM_WEB_ORIGIN_PROD
  web: { dev: "https://dev.shop.example.com", prod: "https://shop.example.com" },
  // API 호스트가 웹과 다를 때. 탐색 가드가 내부로 보고, 데이터 QA가 이 주소로 다시 조회한다.
  apiOrigin: "https://api-dev.shop.example.com",

  // 하단 탭바(웹 링크). 홈 탭을 누르면 homePath로 간다. 플로우는 홈에서 시작한다.
  homePath: "/home",
  homeTabName: "홈",
  tabPaths: { 카테고리: "/category", 혜택: "/benefit", 마이: "/my" },
  // 화면 상단 뒤로 버튼 이름(aria-label)
  inPageBackNames: ["뒤로가기"],
  // 여기로 튕기면 로그인이 풀린 것으로 본다
  loginPaths: ["/login"],
  appErrorText: "Application error",

  // 시나리오 경로 → sampleshop://benefit/attendance. 앱이 같은 웹 경로를 WebView 스택으로 연다고 본다.
  deepLink: { scheme: "sampleshop", homeHost: "home" },
  android: {
    // 이 액티비티가 아닌 앱 화면(네이티브 오퍼월 등)이 위에 있으면 뒤로 키로 닫는다. 비우면 닫지 않는다.
    mainActivity: "com.example.shop.MainActivity",
  },
  webview: {
    // 열린 WebView 스택을 모두 닫는 앱 브리지(예: flutter_inappwebview 핸들러). 비우면 닫지 않는다.
    stackResetScript: "window.appBridge && window.appBridge.callHandler && window.appBridge.callHandler('stackReset')",
    sheetCloseName: "닫기",
  },

  guard: {
    // 기본 금지어(구매·결제·송금·출금·탈퇴…)에 더한다
    extraForbiddenButtonWords: ["쿠폰 사용"],
    extraForbiddenApiPatterns: [/coupon\/use/i],
    // 앱이 켜질 때마다 보내 막으면 안 되는 쓰기 요청(푸시 토큰 저장 등)
    pushTokenRequests: [{ method: "POST", path: "/v1/users/{userId}/push-token" }],
  },

  // 고정 주소 화면 점검. excludedScenarioPaths는 앞 단계가 있어야 열리는 완료·중간 화면
  scenarios: [
    { path: "/home", name: "로그인 후 홈 화면이 열린다", when: "홈 화면을 연다", then: "홈 화면이 보인다" },
    { path: "/category", name: "로그인 후 카테고리 화면이 열린다", when: "카테고리 화면을 연다", then: "카테고리 화면이 보인다" },
    { path: "/benefit/attendance", name: "로그인 후 출석체크 화면이 열린다", when: "출석체크를 연다", then: "출석 화면이 보인다" },
    { path: "/my", name: "로그인 후 마이 화면이 열린다", when: "마이 화면을 연다", then: "마이 화면이 보인다" },
    { path: "/order/complete", name: "로그인 후 주문 완료 화면이 열린다", when: "주문 완료 화면을 연다", then: "주문 완료 화면이 보인다" },
  ],
  excludedScenarioPaths: ["/order/complete"],

  // 데이터 QA(선택): 화면이 부르는 GET API를 다시 불러 화면 글자와 맞춰 본다. LLM 없이 규칙으로만 판정한다.
  qa: {
    sessionPath: "/api/auth/session",
    screens: [
      {
        path: "/cart",
        name: "장바구니",
        apis: { cart: "/v1/users/{userId}/cart" },
        rules: [
          {
            id: "total-equals-items",
            title: "합계 = 항목 금액 합",
            check: (context) => {
              const items = (context.responses.cart as { items?: { priceWon: number }[] } | undefined)?.items;
              if (!Array.isArray(items)) throw new Error("cart.items가 배열이 아닙니다.");
              return equalWon("합계", numberAt(context, "cart", "totalWon"), items.reduce((sum, item) => sum + item.priceWon, 0));
            },
          },
          {
            id: "total-shown",
            title: "받은 합계가 화면에 그대로 보인다",
            check: (context) => {
              const shown = `${formatWon(numberAt(context, "cart", "totalWon"))}원`;
              return textHas(context.text, shown) ? null : `화면에 없음: 합계 「${shown}」`;
            },
          },
        ],
      },
    ],
  },

  // 정책 대조(선택): Confluence 스페이스에서 제목에 titleQuery가 든 페이지를 정책 정본으로 본다. 토큰은 .env
  policy: {
    confluence: { cloudId: "00000000-0000-0000-0000-000000000000", spaceKey: "SHOP", titleQuery: "정책", siteUrl: "https://example.atlassian.net/wiki" },
  },
  // 피그마 대조(선택): 프론트(Next.js App Router) 체크아웃에서 화면 → 피그마 노드를 뽑는다. 토큰은 .env의 FIGMA_TOKEN
  figma: { frontRepo: "", ref: "origin/main", appDir: "app" },

  // 빌드 받기(선택): Firebase App Distribution 앱 id(비우면 .env), iOS dev는 TestFlight에서 깔기
  install: {
    sources: { ios: { dev: "testflight" } },
    testflightDevAppName: "Sample Shop DEV",
  },
  // WDA 서명 팀·번들 id(비우면 .env의 IOS_TEAM_ID·IOS_WDA_BUNDLE_ID)
  ios: {},
  // 디바이스팜 화면에 들어올 수 있는 Tailscale 계정 도메인(비우면 이 맥에서만)
  access: { allowedDomains: ["example.com"] },
});

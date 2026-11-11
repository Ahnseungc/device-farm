/**
 * 테스트·문서용 가상 앱 「Sample Shop」. 실제 앱이 아니다. 루트 `farm.config.example.ts`와 같은 모양이다.
 */
import { equalWon, formatWon, numberAt, textHas, type QaScreen } from "../qa/rules";
import { defineAppConfig } from "./app-config";

/** 데이터 QA 예시: 장바구니 합계 = 항목 합, 합계가 화면에 그대로 보인다 */
export const sampleCartQa: QaScreen = {
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
};

export const sampleApp = defineAppConfig({
  name: "Sample Shop",
  appIds: { dev: "com.example.shop.dev", prod: "com.example.shop" },
  web: { dev: "https://dev.shop.example.com", prod: "https://shop.example.com" },
  apiOrigin: "https://api-dev.shop.example.com",
  homePath: "/home",
  homeTabName: "홈",
  tabPaths: { 카테고리: "/category", 혜택: "/benefit", 마이: "/my" },
  inPageBackNames: ["뒤로가기", "왼쪽 아이콘 버튼"],
  loginPaths: ["/login", "/sign-in"],
  deepLink: { scheme: "sampleshop", homeHost: "home" },
  guard: {
    extraForbiddenButtonWords: ["카카오톡"],
    pushTokenRequests: [{ method: "POST", path: "/v1/users/{userId}/push-token" }],
  },
  scenarios: [
    { path: "/home", name: "로그인 후 홈 화면이 열린다", when: "홈 화면을 연다", then: "홈 화면이 보인다" },
    { path: "/category", name: "로그인 후 카테고리 화면이 열린다", when: "카테고리 화면을 연다", then: "카테고리 화면이 보인다" },
    { path: "/benefit/attendance", name: "로그인 후 출석체크 화면이 열린다", when: "출석체크를 연다", then: "출석 화면이 보인다" },
    { path: "/my", name: "로그인 후 마이 화면이 열린다", when: "마이 화면을 연다", then: "마이 화면이 보인다" },
    { path: "/order/complete", name: "로그인 후 주문 완료 화면이 열린다", when: "주문 완료 화면을 연다", then: "주문 완료 화면이 보인다" },
  ],
  excludedScenarioPaths: ["/order/complete"],
  qa: { screens: [sampleCartQa] },
  install: { sources: { ios: { dev: "testflight" } }, testflightDevAppName: "Sample Shop DEV" },
});

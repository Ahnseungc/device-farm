/**
 * 데모 데이터: 가상의 쇼핑 앱 「Sample Shop」을 가상의 기기 세 대로 점검한 기록. 서버 없이 화면만 보여 준다.
 * 시각은 지금 기준 상대값으로 만들어 언제 열어도 최근 기록처럼 보인다.
 */
import type { ChaosRun, ChaosRunSummary, ChaosStep } from "@device-farm/core/chaos/types";
import { publicAppConfig, type PublicAppConfig } from "@device-farm/core/config/app-config";
import { sampleApp } from "@device-farm/core/config/sample-app";
import type { ScreenMap } from "@device-farm/core/device/screen-map";
import type { Device, DeviceRun, LogEntry } from "@device-farm/core/device/types";
import type { ExploreRun } from "@device-farm/core/explore/actions";
import type { PolicyCheck, PolicyIgnore } from "@device-farm/core/policy/compare";
import type { PolicyRule } from "@device-farm/core/policy/rules";
import type { PolicyWatchState } from "@device-farm/core/policy/snapshot";

import type { DeviceWithState, FlowsState } from "../api-client";
import { homeDiffUrl, screenUrl, type ScreenId } from "./screens";

const minuteMs = 60_000;
const hourMs = 60 * minuteMs;
const dayMs = 24 * hourMs;
const now = Date.now();
const ago = (ms: number) => new Date(now - ms).toISOString();

export const demoApp: PublicAppConfig = publicAppConfig(sampleApp);

const pixel: Device = { id: "demo-pixel-8", platform: "android", model: "Pixel 8", osVersion: "15", appVersion: "1.8.0" };
const galaxy: Device = { id: "demo-galaxy-s24", platform: "android", model: "Galaxy S24", osVersion: "14", appVersion: "1.8.0" };
const iphone: Device = { id: "demo-iphone-16", platform: "ios", model: "iPhone 16", osVersion: "18.1", appVersion: "1.8.0" };

export const demoDevices: DeviceWithState[] = [
  { ...pixel, state: "idle" },
  { ...galaxy, state: "idle" },
  { ...iphone, state: "idle" },
];

/** 기기 카드·상세에 보일 화면 */
export const liveScreens: Record<string, ScreenId> = { [pixel.id]: "home", [galaxy.id]: "category", [iphone.id]: "my" };

const [homeScenario, categoryScenario, attendanceScenario, myScenario] = sampleApp.scenarios.map((scenario) => scenario.name);
const flowName = "플로우 · 혜택에서 출석체크 열기";
const cartName = "데이터 · 장바구니";
const policyName = "정책 · /benefit/attendance";
const failedDir = "test-results/runs/demo-run/pixel-8/home";
const policyPageId = "1001";

const policyChecks: PolicyCheck[] = [
  { id: "p-attendance-point", title: "출석 1회에 10P를 적립한다", ok: true, ignoreKey: "p-attendance-point", ignoreHash: "a1b2c3" },
  {
    id: "p-attendance-bonus",
    title: "7일 연속 출석하면 보너스 50P를 안내한다",
    ok: false,
    finding: "bug-candidate",
    message: "[버그 후보] 화면에 없음: 「7일 연속 출석 시 50P」 피그마에는 있습니다. · 「출석체크 정책」",
    ignoreKey: "p-attendance-bonus",
    ignoreHash: "a1b2c3",
    pageId: policyPageId,
  },
];

export const demoRun: DeviceRun = {
  runId: "demo-run",
  kind: "dev",
  version: "1.8.0",
  trigger: "auto",
  startedAt: ago(42 * minuteMs),
  finishedAt: ago(31 * minuteMs),
  scenarioCount: 7,
  outcomes: [
    {
      device: pixel,
      status: "failed",
      screens: [
        { scenario: homeScenario, status: "failed", message: "기준 화면과 다릅니다.", logDir: failedDir },
        { scenario: categoryScenario, status: "passed" },
        { scenario: attendanceScenario, status: "passed" },
        { scenario: myScenario, status: "passed" },
        {
          scenario: flowName,
          status: "passed",
          steps: [
            { index: 0, type: "home", target: "홈", status: "passed", durationMs: 2100 },
            { index: 1, type: "click", target: "혜택", status: "passed", durationMs: 2400 },
            { index: 2, type: "click", target: "출석체크", status: "passed", durationMs: 2600 },
            { index: 3, type: "expectText", target: "오늘 출석하기", status: "passed", durationMs: 300 },
          ],
        },
        {
          scenario: cartName,
          status: "passed",
          checks: [
            { id: "total-equals-items", title: "합계 = 항목 금액 합", ok: true },
            { id: "total-shown", title: "받은 합계가 화면에 그대로 보인다", ok: true },
          ],
        },
        { scenario: policyName, status: "failed", message: "정책 규칙 2개 중 1개가 화면과 다릅니다.", checks: policyChecks },
      ],
    },
    {
      device: galaxy,
      status: "passed",
      screens: [
        { scenario: homeScenario, status: "passed" },
        { scenario: categoryScenario, status: "passed" },
        { scenario: attendanceScenario, status: "candidate", message: "기준 화면이 없어 후보로 저장했습니다." },
        { scenario: myScenario, status: "passed" },
        { scenario: flowName, status: "passed" },
        { scenario: cartName, status: "passed" },
      ],
    },
    {
      device: iphone,
      status: "passed",
      screens: [
        { scenario: homeScenario, status: "candidate", message: "기준 화면이 없어 후보로 저장했습니다." },
        { scenario: categoryScenario, status: "passed" },
        { scenario: attendanceScenario, status: "login_required", message: "로그인 화면으로 이동했습니다." },
        { scenario: myScenario, status: "candidate", message: "기준 화면이 없어 후보로 저장했습니다." },
        { scenario: flowName, status: "passed" },
        { scenario: cartName, status: "passed" },
      ],
    },
  ],
};

/** 실패 묶음 로그(`logs.jsonl`) */
export const demoLogs: LogEntry[] = [
  { at: now - 33 * minuteMs, source: "system", text: "딥링크 열기 sampleshop://home" },
  { at: now - 33 * minuteMs + 900, source: "network", text: "GET https://api-dev.shop.example.com/v1/home/banners 200 182ms" },
  { at: now - 33 * minuteMs + 1300, source: "network", text: "GET https://cdn.shop.example.com/banner/november.webp 404 41ms" },
  { at: now - 33 * minuteMs + 1400, source: "console", text: "Failed to load resource: the server responded with a status of 404" },
  { at: now - 33 * minuteMs + 1700, source: "console", text: "Warning: price is NaN for product 102" },
];

const chaosShot = "e1-s7.png";

/** `test-results/` 뒤 경로 → 데모 이미지 */
export const demoFiles: Record<string, string> = {
  "runs/demo-run/pixel-8/home/baseline.png": screenUrl("home"),
  "runs/demo-run/pixel-8/home/screenshot.png": screenUrl("homeBroken"),
  "runs/demo-run/pixel-8/home/diff.png": homeDiffUrl(),
  [`chaos/demo-chaos-2/${chaosShot}`]: screenUrl("attendanceError"),
};

export const demoPendingBaselines: string[] = [
  `${galaxy.model}|${galaxy.osVersion}|${attendanceScenario}`,
  `${iphone.model}|${iphone.osVersion}|${homeScenario}`,
  `${iphone.model}|${iphone.osVersion}|${myScenario}`,
];

/** 후보 키의 화면 이름 → 이미지 */
export const candidateScreens: Record<string, ScreenId> = {
  [homeScenario]: "home",
  [categoryScenario]: "category",
  [attendanceScenario]: "attendance",
  [myScenario]: "my",
};

const seenAt = ago(35 * minuteMs);
export const demoScreenMap: ScreenMap = {
  edges: [
    { from: "/home", role: "button", name: "검색", kind: "navigate", to: "/search", texts: ["최근 검색어"], seenAt },
    { from: "/home", role: "link", name: "오늘의 특가", kind: "navigate", to: "/event/november", texts: ["11월 특가"], seenAt },
    { from: "/home", role: "button", name: "쿠폰", kind: "popup", texts: ["쿠폰을 받았어요"], seenAt },
    { from: "/home", role: "link", name: "러닝화 에어 3", kind: "navigate", to: "/product/101", texts: ["러닝화 에어 3"], seenAt },
    { from: "/home", role: "button", name: "다시 시도", kind: "dead", seenAt },
    { from: "/product/101", role: "button", name: "장바구니 담기", kind: "popup", texts: ["장바구니에 담았어요"], seenAt },
    { from: "/product/101", role: "link", name: "리뷰 전체 보기", kind: "navigate", to: "/product/101/reviews", texts: ["리뷰 128개"], seenAt },
    { from: "/product/101", role: "button", name: "사이즈 안내", kind: "error", message: "GET /v1/products/101/size 500", seenAt },
    { from: "/benefit", role: "link", name: "출석체크", kind: "navigate", to: "/benefit/attendance", texts: ["오늘 출석하기"], seenAt },
    { from: "/benefit", role: "link", name: "친구 초대", kind: "navigate", to: "/benefit/invite", texts: ["친구 초대하고 1,000P"], seenAt },
    { from: "/benefit/attendance", role: "button", name: "출석 안내", kind: "popup", texts: ["매일 출석하면 10P 적립"], seenAt },
    { from: "/my", role: "link", name: "주문 내역", kind: "navigate", to: "/my/orders", texts: ["주문 내역"], seenAt },
    { from: "/my", role: "link", name: "쿠폰함", kind: "navigate", to: "/my/coupons", texts: ["사용 가능 2장"], seenAt },
    { from: "/my/orders", role: "button", name: "기간 설정", kind: "popup", texts: ["최근 3개월"], seenAt },
  ],
};

export const demoFlows: FlowsState = {
  prdRootSet: true,
  llmConfigured: true,
  prds: ["app/(shop)/benefit/_src/specs/README.md", "app/(shop)/cart/_src/specs/README.md"],
  ready: [
    {
      id: "attendance-open",
      name: "혜택에서 출석체크 열기",
      source: "map_built",
      status: "ready",
      prd: "화면 지도",
      requirement: "혜택 탭에서 출석체크를 열 수 있다",
      steps: [
        { type: "click", target: { role: "link", name: "혜택" } },
        { type: "click", target: { role: "link", name: "출석체크" } },
        { type: "expectText", text: "오늘 출석하기" },
      ],
    },
  ],
  candidates: [
    {
      id: "product-to-cart",
      name: "상품을 장바구니에 담기",
      source: "ai_generated",
      status: "generated",
      proposal: "create",
      prd: "app/(shop)/cart/_src/specs/README.md",
      requirement: "상품 상세에서 장바구니에 담으면 안내 문구가 보인다",
      steps: [
        { type: "click", target: { role: "link", name: "러닝화 에어 3" } },
        { type: "click", target: { role: "button", name: "장바구니 담기" } },
        { type: "expectText", text: "장바구니에 담았어요" },
      ],
    },
    {
      id: "my-coupons",
      name: "마이에서 쿠폰함 열기",
      source: "recorded",
      status: "generated",
      proposal: "create",
      prd: "화면 지도",
      requirement: "녹화한 조작",
      steps: [
        { type: "click", target: { role: "link", name: "마이" } },
        { type: "click", target: { role: "link", name: "쿠폰함" } },
        { type: "expectText", text: "사용 가능 2장" },
      ],
    },
  ],
};

const candidates = (entries: [string, number, number][]) => entries.map(([key, score, probability]) => ({ key, score, probability }));

function chaosStep(step: number, from: string, to: string, chosen: string, chosenProbability: number, extra: Partial<ChaosStep> = {}): ChaosStep {
  return {
    episode: 1,
    step,
    at: ago(3 * hourMs - step * 20_000),
    from,
    state: `${from}|팝업 0`,
    candidates: candidates([
      [chosen, 2.4, chosenProbability],
      ["back::", 0.6, 0.12],
      ["tab:link:마이", 0.4, 0.08],
      ["doubleTap:button:다시 시도", 0.3, 0.06],
    ]),
    chosen,
    chosenProbability,
    to,
    newState: false,
    dead: false,
    errors: [],
    warnings: [],
    ...extra,
  };
}

const chaosSteps: ChaosStep[] = [
  chaosStep(1, "/home", "/product/101", "press:link:러닝화 에어 3", 0.42, { newState: true }),
  chaosStep(2, "/product/101", "/product/101", "doubleTap:button:장바구니 담기", 0.18, { newState: true }),
  chaosStep(3, "/product/101", "/home", "back::", 0.12),
  chaosStep(4, "/home", "/benefit", "tab:link:혜택", 0.21, { newState: true }),
  chaosStep(5, "/benefit", "/benefit/attendance", "press:link:출석체크", 0.38, { newState: true }),
  chaosStep(6, "/benefit/attendance", "/benefit/attendance", "background::", 0.09),
  chaosStep(7, "/benefit/attendance", "/benefit/attendance", "backDuringLoad::", 0.15, {
    errors: [{ kind: "network", message: "POST /v1/attendance/check 503" }],
    screenshot: chaosShot,
  }),
  chaosStep(8, "/benefit/attendance", "/benefit/attendance", "press:button:오늘 출석하기", 0.31, { dead: true }),
  chaosStep(9, "/benefit/attendance", "/home", "homeReset::", 0.05),
  chaosStep(10, "/home", "/my", "tab:link:마이", 0.22, { newState: true }),
];

export const demoChaosRuns: ChaosRun[] = [
  {
    runId: "demo-chaos-2",
    deviceId: pixel.id,
    seed: 42,
    startedAt: ago(3 * hourMs),
    finishedAt: ago(3 * hourMs - 4 * minuteMs),
    steps: chaosSteps,
    states: 6,
    blocked: ["POST /v1/attendance/check", "POST /v1/cart/items"],
  },
  {
    runId: "demo-chaos-1",
    deviceId: galaxy.id,
    seed: 7,
    startedAt: ago(dayMs),
    finishedAt: ago(dayMs - 3 * minuteMs),
    steps: chaosSteps.slice(0, 5).map((step) => ({ ...step, errors: [] })),
    states: 4,
    blocked: [],
  },
];

export const demoChaosSummaries: ChaosRunSummary[] = demoChaosRuns.map((run) => ({
  runId: run.runId,
  deviceId: run.deviceId,
  seed: run.seed,
  startedAt: run.startedAt,
  finishedAt: run.finishedAt,
  steps: run.steps.length,
  states: run.states,
  errorSteps: run.steps.filter((step) => step.errors.length > 0).length,
  blocked: run.blocked.length,
}));

const policyUrl = (id: string) => `https://example.com/wiki/pages/${id}`;

const attendanceRules: PolicyRule[] = [
  {
    id: "p-attendance-point",
    pageId: policyPageId,
    pageTitle: "출석체크 정책",
    pageHash: "a1b2c3",
    since: ago(40 * dayMs),
    kind: "copy",
    section: "적립",
    statement: "출석 1회에 10P를 적립한다",
    expected: "10P 적립",
    evidence: "출석 1회당 10P를 적립한다.",
    screens: ["/benefit/attendance"],
    visibleOnOpen: true,
  },
  {
    id: "p-attendance-bonus",
    pageId: policyPageId,
    pageTitle: "출석체크 정책",
    pageHash: "a1b2c3",
    since: ago(30 * dayMs),
    kind: "copy",
    section: "보너스",
    statement: "7일 연속 출석하면 보너스 50P를 안내한다",
    expected: "7일 연속 출석 시 50P",
    evidence: "7일 연속 출석 시 50P를 추가로 적립한다.",
    screens: ["/benefit/attendance"],
    visibleOnOpen: true,
  },
  {
    id: "p-attendance-once",
    pageId: policyPageId,
    pageTitle: "출석체크 정책",
    pageHash: "a1b2c3",
    since: ago(5 * dayMs),
    kind: "behavior",
    section: "제한",
    statement: "하루에 한 번만 출석할 수 있다",
    evidence: "출석은 하루 1회로 제한한다.",
    screens: ["/benefit/attendance"],
    visibleOnOpen: false,
  },
];

const shippingRules: PolicyRule[] = [
  {
    id: "p-shipping-free",
    pageId: "1002",
    pageTitle: "배송비 정책",
    pageHash: "d4e5f6",
    since: ago(60 * dayMs),
    kind: "value",
    section: "무료 배송",
    statement: "30,000원 이상 주문은 무료 배송이다",
    expected: "30,000원 이상 무료 배송",
    evidence: "주문 금액 30,000원 이상이면 배송비는 무료다.",
    screens: ["/cart"],
    visibleOnOpen: true,
  },
];

export const demoPolicy: PolicyWatchState = {
  configured: true,
  figmaConfigured: true,
  running: false,
  progress: null,
  checkedAt: ago(7 * hourMs),
  nextAt: new Date(now + 17 * hourMs).toISOString(),
  lastError: null,
  failed: [],
  extractFailed: [],
  pages: [
    { id: policyPageId, title: "출석체크 정책", version: 12, modifiedAt: ago(5 * dayMs), hash: "a1b2c3", webUrl: policyUrl(policyPageId) },
    { id: "1002", title: "배송비 정책", version: 4, modifiedAt: ago(60 * dayMs), hash: "d4e5f6", webUrl: policyUrl("1002") },
    { id: "1003", title: "쿠폰 사용 정책", version: 9, modifiedAt: ago(90 * dayMs), hash: "a7b8c9", webUrl: policyUrl("1003") },
  ],
  changes: [
    { at: ago(5 * dayMs), kind: "changed", id: policyPageId, title: "출석체크 정책", version: 12, fromVersion: 11, hash: "a1b2c3" },
    { at: ago(20 * dayMs), kind: "added", id: "1003", title: "쿠폰 사용 정책", version: 9, hash: "a7b8c9" },
  ],
  rules: [
    {
      pageId: policyPageId,
      pageTitle: "출석체크 정책",
      extractedAt: ago(5 * dayMs),
      screens: ["/benefit/attendance"],
      figma: 2,
      rules: attendanceRules,
      dropped: [{ statement: "출석 포인트는 30일 뒤 사라진다", reason: "근거 인용이 본문에 없습니다." }],
    },
    { pageId: "1002", pageTitle: "배송비 정책", extractedAt: ago(60 * dayMs), screens: ["/cart"], figma: 1, rules: shippingRules, dropped: [] },
  ],
};

export const demoPolicyIgnored: { items: PolicyIgnore[] } = { items: [] };

export const demoExplore: ExploreRun[] = [
  {
    runId: "demo-explore",
    deviceId: pixel.id,
    startedAt: ago(5 * hourMs),
    finishedAt: ago(5 * hourMs - 6 * minuteMs),
    paths: [
      { id: "p1", actions: [{ kind: "click", role: "link", name: "러닝화 에어 3" }] },
      { id: "p2", actions: [{ kind: "click", role: "link", name: "러닝화 에어 3" }, { kind: "click", role: "button", name: "사이즈 안내" }] },
      { id: "p3", actions: [{ kind: "click", role: "link", name: "혜택" }, { kind: "click", role: "link", name: "출석체크" }] },
    ],
    issues: [
      {
        pathId: "p2",
        kind: "network",
        message: "GET /v1/products/101/size 500",
        screenshot: "test-results/explore/demo-explore/p2/screenshot.png",
        logDir: "test-results/explore/demo-explore/p2",
      },
    ],
    blocked: [{ method: "POST", path: "/v1/cart/items", reason: "unknown", at: now - 5 * hourMs, pathId: "p1" }],
    cleanPathIds: ["p3"],
    replayFailures: [],
  },
];

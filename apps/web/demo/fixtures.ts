/**
 * 데모 데이터: 가상의 쇼핑 앱 「Sample Shop」을 가상의 기기 세 대로 점검한 기록. 서버 없이 화면만 보여 준다.
 * 시각은 지금 기준 상대값으로 만들어 언제 열어도 최근 기록처럼 보인다.
 */
import type { ChaosRun, ChaosRunSummary, ChaosStep } from "@device-farm/core/chaos/types";
import { defineAppConfig, publicAppConfig, type PublicAppConfig } from "@device-farm/core/config/app-config";
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

/** 가상의 「Sample Shop」을 영어로. 데모는 영어 화면이다(`locale: "en"`) */
const demoAppConfig = defineAppConfig({
  name: "Sample Shop",
  locale: "en",
  appIds: { dev: "com.example.shop.dev", prod: "com.example.shop" },
  homePath: "/home",
  homeTabName: "Home",
  tabPaths: { Category: "/category", Rewards: "/benefit", Me: "/my" },
  inPageBackNames: ["Back"],
  scenarios: [
    { path: "/home", name: "Home opens after login", when: "Open the home screen", then: "The home screen is shown" },
    { path: "/category", name: "Category opens after login", when: "Open the category screen", then: "The category screen is shown" },
    { path: "/benefit/attendance", name: "Check-in opens after login", when: "Open check-in", then: "The check-in screen is shown" },
    { path: "/my", name: "Me opens after login", when: "Open the Me screen", then: "The Me screen is shown" },
  ],
});

export const demoApp: PublicAppConfig = publicAppConfig(demoAppConfig);

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

const [homeScenario, categoryScenario, attendanceScenario, myScenario] = demoAppConfig.scenarios.map((scenario) => scenario.name);
const flowName = "Flow · Open check-in from Rewards";
const cartName = "Data · Cart";
const policyName = "Policy · /benefit/attendance";
const failedDir = "test-results/runs/demo-run/pixel-8/home";
const policyPageId = "1001";

const policyChecks: PolicyCheck[] = [
  { id: "p-attendance-point", title: "Each check-in earns 10P", ok: true, ignoreKey: "p-attendance-point", ignoreHash: "a1b2c3" },
  {
    id: "p-attendance-bonus",
    title: "Shows the 50P bonus for a 7-day check-in streak",
    ok: false,
    finding: "bug-candidate",
    message: "[Bug candidate] Not on screen: “50P for a 7-day streak” (it is in Figma) · “Check-in policy”",
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
        { scenario: homeScenario, status: "failed", message: "Differs from the baseline.", logDir: failedDir },
        { scenario: categoryScenario, status: "passed" },
        { scenario: attendanceScenario, status: "passed" },
        { scenario: myScenario, status: "passed" },
        {
          scenario: flowName,
          status: "passed",
          steps: [
            { index: 0, type: "home", target: "Home", status: "passed", durationMs: 2100 },
            { index: 1, type: "click", target: "Rewards", status: "passed", durationMs: 2400 },
            { index: 2, type: "click", target: "Check-in", status: "passed", durationMs: 2600 },
            { index: 3, type: "expectText", target: "Check in today", status: "passed", durationMs: 300 },
          ],
        },
        {
          scenario: cartName,
          status: "passed",
          checks: [
            { id: "total-equals-items", title: "Total = sum of item prices", ok: true },
            { id: "total-shown", title: "The total from the API is shown as-is", ok: true },
          ],
        },
        { scenario: policyName, status: "failed", message: "1 of 2 policy rules differs from the screen.", checks: policyChecks },
      ],
    },
    {
      device: galaxy,
      status: "passed",
      screens: [
        { scenario: homeScenario, status: "passed" },
        { scenario: categoryScenario, status: "passed" },
        { scenario: attendanceScenario, status: "candidate", message: "No baseline yet; saved as a candidate." },
        { scenario: myScenario, status: "passed" },
        { scenario: flowName, status: "passed" },
        { scenario: cartName, status: "passed" },
      ],
    },
    {
      device: iphone,
      status: "passed",
      screens: [
        { scenario: homeScenario, status: "candidate", message: "No baseline yet; saved as a candidate." },
        { scenario: categoryScenario, status: "passed" },
        { scenario: attendanceScenario, status: "login_required", message: "Redirected to the login screen." },
        { scenario: myScenario, status: "candidate", message: "No baseline yet; saved as a candidate." },
        { scenario: flowName, status: "passed" },
        { scenario: cartName, status: "passed" },
      ],
    },
  ],
};

/** 실패 묶음 로그(`logs.jsonl`) */
export const demoLogs: LogEntry[] = [
  { at: now - 33 * minuteMs, source: "system", text: "Open deep link sampleshop://home" },
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
    { from: "/home", role: "button", name: "Search", kind: "navigate", to: "/search", texts: ["Recent searches"], seenAt },
    { from: "/home", role: "link", name: "Today's deals", kind: "navigate", to: "/event/november", texts: ["November deals"], seenAt },
    { from: "/home", role: "button", name: "Coupons", kind: "popup", texts: ["Coupon received"], seenAt },
    { from: "/home", role: "link", name: "Air Runner 3", kind: "navigate", to: "/product/101", texts: ["Air Runner 3"], seenAt },
    { from: "/home", role: "button", name: "Try again", kind: "dead", seenAt },
    { from: "/product/101", role: "button", name: "Add to cart", kind: "popup", texts: ["Added to cart"], seenAt },
    { from: "/product/101", role: "link", name: "See all reviews", kind: "navigate", to: "/product/101/reviews", texts: ["128 reviews"], seenAt },
    { from: "/product/101", role: "button", name: "Size guide", kind: "error", message: "GET /v1/products/101/size 500", seenAt },
    { from: "/benefit", role: "link", name: "Check-in", kind: "navigate", to: "/benefit/attendance", texts: ["Check in today"], seenAt },
    { from: "/benefit", role: "link", name: "Invite friends", kind: "navigate", to: "/benefit/invite", texts: ["Invite a friend, get 1,000P"], seenAt },
    { from: "/benefit/attendance", role: "button", name: "Check-in info", kind: "popup", texts: ["Earn 10P every day you check in"], seenAt },
    { from: "/my", role: "link", name: "Order history", kind: "navigate", to: "/my/orders", texts: ["Order history"], seenAt },
    { from: "/my", role: "link", name: "My coupons", kind: "navigate", to: "/my/coupons", texts: ["2 available"], seenAt },
    { from: "/my/orders", role: "button", name: "Date range", kind: "popup", texts: ["Last 3 months"], seenAt },
  ],
};

export const demoFlows: FlowsState = {
  prdRootSet: true,
  llmConfigured: true,
  prds: ["app/(shop)/benefit/_src/specs/README.md", "app/(shop)/cart/_src/specs/README.md"],
  ready: [
    {
      id: "attendance-open",
      name: "Open check-in from Rewards",
      source: "map_built",
      status: "ready",
      prd: "Screen map",
      requirement: "Check-in can be opened from the Rewards tab",
      steps: [
        { type: "click", target: { role: "link", name: "Rewards" } },
        { type: "click", target: { role: "link", name: "Check-in" } },
        { type: "expectText", text: "Check in today" },
      ],
    },
  ],
  candidates: [
    {
      id: "product-to-cart",
      name: "Add a product to the cart",
      source: "ai_generated",
      status: "generated",
      proposal: "create",
      prd: "app/(shop)/cart/_src/specs/README.md",
      requirement: "Adding to cart from a product page shows a confirmation",
      steps: [
        { type: "click", target: { role: "link", name: "Air Runner 3" } },
        { type: "click", target: { role: "button", name: "Add to cart" } },
        { type: "expectText", text: "Added to cart" },
      ],
    },
    {
      id: "my-coupons",
      name: "Open My coupons from Me",
      source: "recorded",
      status: "generated",
      proposal: "create",
      prd: "Screen map",
      requirement: "Recorded session",
      steps: [
        { type: "click", target: { role: "link", name: "Me" } },
        { type: "click", target: { role: "link", name: "My coupons" } },
        { type: "expectText", text: "2 available" },
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
    state: `${from}|popups 0`,
    candidates: candidates([
      [chosen, 2.4, chosenProbability],
      ["back::", 0.6, 0.12],
      ["tab:link:Me", 0.4, 0.08],
      ["doubleTap:button:Try again", 0.3, 0.06],
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
  chaosStep(1, "/home", "/product/101", "press:link:Air Runner 3", 0.42, { newState: true }),
  chaosStep(2, "/product/101", "/product/101", "doubleTap:button:Add to cart", 0.18, { newState: true }),
  chaosStep(3, "/product/101", "/home", "back::", 0.12),
  chaosStep(4, "/home", "/benefit", "tab:link:Rewards", 0.21, { newState: true }),
  chaosStep(5, "/benefit", "/benefit/attendance", "press:link:Check-in", 0.38, { newState: true }),
  chaosStep(6, "/benefit/attendance", "/benefit/attendance", "background::", 0.09),
  chaosStep(7, "/benefit/attendance", "/benefit/attendance", "backDuringLoad::", 0.15, {
    errors: [{ kind: "network", message: "POST /v1/attendance/check 503" }],
    screenshot: chaosShot,
  }),
  chaosStep(8, "/benefit/attendance", "/benefit/attendance", "press:button:Check in today", 0.31, { dead: true }),
  chaosStep(9, "/benefit/attendance", "/home", "homeReset::", 0.05),
  chaosStep(10, "/home", "/my", "tab:link:Me", 0.22, { newState: true }),
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
    pageTitle: "Check-in policy",
    pageHash: "a1b2c3",
    since: ago(40 * dayMs),
    kind: "copy",
    section: "Points",
    statement: "Each check-in earns 10P",
    expected: "Earn 10P",
    evidence: "Each check-in earns 10P.",
    screens: ["/benefit/attendance"],
    visibleOnOpen: true,
  },
  {
    id: "p-attendance-bonus",
    pageId: policyPageId,
    pageTitle: "Check-in policy",
    pageHash: "a1b2c3",
    since: ago(30 * dayMs),
    kind: "copy",
    section: "Bonus",
    statement: "Shows the 50P bonus for a 7-day check-in streak",
    expected: "50P for a 7-day streak",
    evidence: "A 7-day check-in streak earns an extra 50P.",
    screens: ["/benefit/attendance"],
    visibleOnOpen: true,
  },
  {
    id: "p-attendance-once",
    pageId: policyPageId,
    pageTitle: "Check-in policy",
    pageHash: "a1b2c3",
    since: ago(5 * dayMs),
    kind: "behavior",
    section: "Limits",
    statement: "Users can check in only once a day",
    evidence: "Check-in is limited to once per day.",
    screens: ["/benefit/attendance"],
    visibleOnOpen: false,
  },
];

const shippingRules: PolicyRule[] = [
  {
    id: "p-shipping-free",
    pageId: "1002",
    pageTitle: "Shipping fee policy",
    pageHash: "d4e5f6",
    since: ago(60 * dayMs),
    kind: "value",
    section: "Free shipping",
    statement: "Orders of $30 or more ship free",
    expected: "Free shipping on orders over $30",
    evidence: "Shipping is free when the order total is $30 or more.",
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
    { id: policyPageId, title: "Check-in policy", version: 12, modifiedAt: ago(5 * dayMs), hash: "a1b2c3", webUrl: policyUrl(policyPageId) },
    { id: "1002", title: "Shipping fee policy", version: 4, modifiedAt: ago(60 * dayMs), hash: "d4e5f6", webUrl: policyUrl("1002") },
    { id: "1003", title: "Coupon policy", version: 9, modifiedAt: ago(90 * dayMs), hash: "a7b8c9", webUrl: policyUrl("1003") },
  ],
  changes: [
    { at: ago(5 * dayMs), kind: "changed", id: policyPageId, title: "Check-in policy", version: 12, fromVersion: 11, hash: "a1b2c3" },
    { at: ago(20 * dayMs), kind: "added", id: "1003", title: "Coupon policy", version: 9, hash: "a7b8c9" },
  ],
  rules: [
    {
      pageId: policyPageId,
      pageTitle: "Check-in policy",
      extractedAt: ago(5 * dayMs),
      screens: ["/benefit/attendance"],
      figma: 2,
      rules: attendanceRules,
      dropped: [{ statement: "Check-in points expire after 30 days", reason: "The quoted evidence is not in the page." }],
    },
    { pageId: "1002", pageTitle: "Shipping fee policy", extractedAt: ago(60 * dayMs), screens: ["/cart"], figma: 1, rules: shippingRules, dropped: [] },
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
      { id: "p1", actions: [{ kind: "click", role: "link", name: "Air Runner 3" }] },
      { id: "p2", actions: [{ kind: "click", role: "link", name: "Air Runner 3" }, { kind: "click", role: "button", name: "Size guide" }] },
      { id: "p3", actions: [{ kind: "click", role: "link", name: "Rewards" }, { kind: "click", role: "link", name: "Check-in" }] },
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

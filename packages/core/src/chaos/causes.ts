/**
 * 봇 점검 오류를 원인별로 묶는다. 같은 깨진 주소가 요청 실패·콘솔 404·RSC 실패로 세 번 보이던 것을 한 장으로,
 * 빈 화면 판정 두 개(blank·layout)를 한 장으로. 그리고 고칠 문제와 참고(개발 경고·SDK 로그)를 나눈다(2026-11-12).
 */

import type { ChaosRun, ChaosStep } from "./types";

export type CauseLevel = "problem" | "note";

export interface BotCause {
  key: string;
  level: CauseLevel;
  /** 사람 말 제목(「깨진 링크 404: /a/hZMQ…」) */
  title: string;
  /** 대표 메시지(가장 긴 것) */
  detail: string;
  /** 모인 신호 종류(network·console 등) */
  signals: string[];
  /** 처음 나타난 화면: 로그를 낸 화면, 모르면 그 단계의 출발 화면 */
  firstScreen: string;
  /** 나타난 화면들 */
  screens: string[];
  /** 나타난 단계 수 */
  count: number;
  firstStep: { episode: number; step: number };
  screenshot?: string;
}

const urlPattern = /https?:\/\/[^\s"'<>)]+/;

/**
 * 주소 → 비교용: 쿼리 빼고 디코드한 뒤 따옴표·공백·꺾쇠 앞까지. 같은 깨진 링크도 요청 로그는 중간이 잘리고
 * RSC 오류는 끝까지 나와(`/a/hZMQ…" target="_blank"…`) 둘이 다른 원인으로 갈렸다.
 */
function normalizeUrl(raw: string): string {
  const withoutQuery = raw.split(/[?#]/)[0];
  let decoded = withoutQuery;
  try {
    decoded = decodeURIComponent(withoutQuery);
  } catch {
    // 잘린 %xx는 그대로 둔다
  }
  return decoded.split(/["'<>\s]/)[0];
}

/** 제목에 쓸 짧은 주소: 호스트 빼고 40자 */
function shortPath(url: string): string {
  const path = url.replace(/^https?:\/\/[^/]+/, "") || "/";
  return path.length > 40 ? `${path.slice(0, 40)}…` : path;
}

/** 고칠 문제가 아니라 참고로 내리는 콘솔 글: 개발 빌드 접근성 경고, SDK·푸시 네트워크 로그 */
const noteConsole = [/requires a `DialogTitle`/, /Missing `Description`/, /^Fcm Error/, /^Firebase 로그인 실패/, /Download the React DevTools/];
/** 콘솔이어도 앱 코드가 터진 것 */
const crashConsole = /Uncaught|TypeError|ReferenceError|is not a function|Cannot read propert/;

type Signal = { kind: string; message: string; step: ChaosStep };

/** 신호 하나 → 원인 키·수준·제목 */
function classify(signal: Signal): { key: string; level: CauseLevel; title: string } {
  const { kind, message, step } = signal;
  const url = urlPattern.exec(message)?.[0];
  const status = /\b(4\d\d|5\d\d)\b/.exec(message)?.[1];
  if (url && (kind === "network" || /RSC payload|Failed to load resource/.test(message))) {
    const normalized = normalizeUrl(url);
    return { key: `link|${normalized}`, level: "problem", title: `깨진 링크${status ? ` ${status}` : ""}: ${shortPath(normalized)}` };
  }
  if (kind === "blank" || (kind === "layout" && /빈 화면/.test(message))) {
    const path = message.startsWith("/") ? message.split(" ")[0] : step.to;
    // 다른 앱·백그라운드에서 돌아온 뒤 흰 화면은 화면을 열 때 흰 화면과 원인이 달라 따로 묶는다
    if (/돌아온 뒤/.test(message)) return { key: `blank-return|${path}`, level: "problem", title: `돌아온 뒤 빈 화면: ${path}` };
    return { key: `blank|${path}`, level: "problem", title: `빈 화면: ${path}` };
  }
  if (kind === "layout") {
    const path = message.split(" ")[0];
    return { key: `layout|${message.replace(/\d[\d,.:]*/g, "#").slice(0, 120)}`, level: "problem", title: `화면 깨짐: ${path}` };
  }
  if (kind === "stuck") return { key: `stuck|${step.from}`, level: "problem", title: `눌러도 반응 없음: ${step.from}` };
  if (kind === "app-error") return { key: `app-error|${step.to}`, level: "problem", title: `오류 화면: ${step.to}` };
  if (kind === "crash") return { key: `crash|${step.to}`, level: "problem", title: `앱 멈춤: ${step.to}` };
  if (kind === "login-redirect") return { key: `login|${step.from}`, level: "problem", title: `로그인으로 튕김: ${step.from}` };
  const stable = message.replace(/\d[\d,.:]*/g, "#").split("\n")[0].slice(0, 100);
  if (kind === "console" && !noteConsole.some((pattern) => pattern.test(message)) && crashConsole.test(message)) {
    return { key: `console|${stable}`, level: "problem", title: `스크립트 오류: ${stable.slice(0, 50)}` };
  }
  return { key: `${kind}|${stable}`, level: "note", title: `${kind === "console" ? "콘솔" : kind}: ${stable.slice(0, 60)}` };
}

/**
 * 실행의 오류 → 원인 목록. 같은 단계에서 깨진 링크와 함께 나온 「Failed to load resource」(주소 없음)는 그 링크에 붙인다.
 * 고칠 문제 먼저, 그 안에서 많이 나온 순.
 */
export function causesOf(run: ChaosRun): BotCause[] {
  const causes = new Map<string, BotCause>();
  for (const step of run.steps) {
    const classified = step.errors.map((issue) => ({ issue, ...classify({ kind: issue.kind, message: issue.message, step }) }));
    // 주소 없는 「Failed to load resource」는 같은 단계의 깨진 링크로
    const linkInStep = classified.find((item) => item.key.startsWith("link|"));
    for (const item of classified) {
      const orphan404 = !urlPattern.test(item.issue.message) && /Failed to load resource/.test(item.issue.message);
      const target = orphan404 && linkInStep ? linkInStep : item;
      // 로그는 늦게 와 다음 단계에 붙기도 한다. 수집기가 적은 화면이 있으면 그것을 쓴다
      const screen = item.issue.screen ?? step.from;
      const cause = causes.get(target.key) ?? {
        key: target.key,
        level: target.level,
        title: target.title,
        detail: "",
        signals: [],
        firstScreen: screen,
        screens: [],
        count: 0,
        firstStep: { episode: step.episode, step: step.step },
      };
      if (!cause.signals.includes(item.issue.kind)) cause.signals.push(item.issue.kind);
      if (!cause.screens.includes(screen)) cause.screens.push(screen);
      if (item.issue.message.length > cause.detail.length) cause.detail = item.issue.message;
      if (!cause.screenshot && step.screenshot) cause.screenshot = step.screenshot;
      causes.set(target.key, cause);
    }
    // 한 단계에서 같은 원인은 한 번만 센다
    for (const key of new Set(classified.map((item) => (!urlPattern.test(item.issue.message) && /Failed to load resource/.test(item.issue.message) && linkInStep ? linkInStep.key : item.key)))) {
      const cause = causes.get(key);
      if (cause) cause.count += 1;
    }
  }
  return [...causes.values()].sort((a, b) => (a.level === b.level ? b.count - a.count : a.level === "problem" ? -1 : 1));
}

/** Claude 요약용 글: 고칠 문제만 */
export function causesPrompt(run: ChaosRun, causes: readonly BotCause[], appName?: string): string {
  const problems = causes.filter((cause) => cause.level === "problem");
  return [
    `너는 ${appName ? `${appName} 앱` : "점검 대상 앱"} QA 담당이다. 봇이 앱을 무작위로 눌러 본 기록에서 묶은 원인 목록을 보고, 사람이 뭘 고쳐야 하는지 한국어 한두 문장(120자 안)으로 말해라.`,
    "원인이 없으면 「고칠 문제가 없어요」라고만 써라. 추측이면 「확인 필요」를 붙여라. 목록에 없는 것은 쓰지 마라. 문장만 출력한다.",
    `기기 ${run.deviceId} · ${run.steps.length}단계 · 처음 본 화면 ${run.states}개`,
    ...problems.map((cause, index) => `${index + 1}. ${cause.title} — ${cause.count}번, 처음 화면 ${cause.firstScreen}, 신호 ${cause.signals.join("+")}: ${cause.detail.slice(0, 300)}`),
  ].join("\n");
}

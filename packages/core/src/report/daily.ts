/**
 * 아침 자동 분석. 지난 기록을 근거 항목(R·B·P 번호)으로 묶어 Claude에게 주고,
 * 돌아온 판단 중 근거 번호가 입력에 있는 것만 남겨 슬랙 한 건으로 만든다. 여기는 순수 로직만 둔다.
 */

import type { ChaosRun } from "../chaos/types";
import type { DeviceRun } from "../device/types";
import type { PolicyCheck } from "../policy/compare";
import { isSensitivePath } from "../policy/judge";
import { designDiffsOf } from "../slack/design-alert";

/** 근거 하나. id로 Claude가 가리킨다 */
export interface Evidence {
  /** R: 기기 점검 실패 화면, B: 봇 점검 오류, P: 정책 버그 후보, D: 피그마와 다른 문구(사용자 데이터 거른 뒤) */
  id: string;
  text: string;
  /** 같은 문제가 몇 번 나왔는가 */
  count: number;
  /** 결과 폴더 기준 스크린샷(있고 민감 화면이 아닐 때만) */
  screenshot?: string;
}

export interface DailyStats {
  runs: number;
  screens: number;
  failedScreens: number;
  flowsPassed: number;
  flows: number;
  botRuns: number;
  botSteps: number;
  botErrorSteps: number;
  policyBugs: number;
  /** 피그마와 다른 문구가 있는 화면 수. 2026-11-12 전 분석에는 없다 */
  designDiffs?: number;
  builds: string[];
}

export interface DailyInput {
  from: string;
  to: string;
  stats: DailyStats;
  evidence: Evidence[];
  /** 어제 분석에서 문제로 본 제목(이어지는지 보려고) */
  previous: string[];
  /** 야간 점검이 건너뛴 이유(있으면) */
  skipped: string[];
}

export const issueKinds = ["app-bug", "data", "design", "unverified", "farm-false-positive", "flaky"] as const;
export type IssueKind = (typeof issueKinds)[number];

export const issueKindLabels: Record<IssueKind, string> = {
  "app-bug": "앱",
  data: "데이터",
  design: "디자인",
  unverified: "확인 필요",
  "farm-false-positive": "디바이스팜 오탐",
  flaky: "일시적",
};

export interface DailyIssue {
  title: string;
  kind: IssueKind;
  evidence: string[];
  action: string;
  new: boolean;
}

export interface DailyAnalysis {
  summary: string;
  issues: DailyIssue[];
  stable: string;
}

/** 근거로 넘길 최대 수 (작성자 판단). 넘치면 많이 나온 것부터 */
export const maxEvidence = 40;

const flowPrefix = "플로우 점검 · ";
const policyPrefix = "정책 점검 · ";
/** 숫자·시각은 지워 같은 문제를 같은 키로 본다(실패 알림과 같은 기준) */
const stable = (text: string) => text.replace(/\d[\d,.:]*/g, "#").slice(0, 160);

type Group = { key: string; text: string; count: number; screenshot?: string };

function group(items: readonly { key: string; text: string; screenshot?: string }[]): Group[] {
  const byKey = new Map<string, Group>();
  for (const item of items) {
    const found = byKey.get(item.key);
    if (found) found.count += 1;
    else byKey.set(item.key, { ...item, count: 1 });
  }
  return [...byKey.values()].sort((a, b) => b.count - a.count);
}

const shot = (path: string | undefined, screenPath: string) => (path && !isSensitivePath(screenPath) ? path : undefined);

/** 실패한 기기 점검 화면(정책 화면은 정책 근거로 따로) */
function runFailures(runs: readonly DeviceRun[]) {
  return runs.flatMap((run) =>
    run.outcomes.flatMap((outcome) =>
      outcome.screens
        .filter((screen) => screen.status === "failed" && !screen.scenario.startsWith(policyPrefix))
        .map((screen) => ({
          key: `${screen.scenario}|${stable(screen.message ?? "")}`,
          text: `[${run.label ?? (run.trigger === "auto" ? "자동 점검" : "점검")} ${run.runId} · ${outcome.device.model}] ${screen.scenario}: ${screen.message ?? "실패"}`,
          screenshot: shot(screen.screenshot, screen.scenario),
        })),
    ),
  );
}

function botErrors(bots: readonly ChaosRun[]) {
  return bots.flatMap((run) =>
    run.steps.flatMap((step) =>
      step.errors.map((error) => ({
        key: `${error.kind}|${stable(error.message)}`,
        text: `[봇 ${run.runId} ${step.episode}-${step.step}] ${step.from} → ${step.chosen} → ${step.to}: ${error.kind} ${error.message.slice(0, 300)}`,
        screenshot: step.screenshot && !isSensitivePath(step.to) ? `chaos/${run.runId}/${step.screenshot}` : undefined,
      })),
    ),
  );
}

function policyBugs(runs: readonly DeviceRun[]) {
  return runs.flatMap((run) =>
    run.outcomes.flatMap((outcome) =>
      outcome.screens
        .filter((screen) => screen.scenario.startsWith(policyPrefix))
        .flatMap((screen) =>
          ((screen.checks ?? []) as PolicyCheck[])
            .filter((check) => !check.ok && !check.ignored && check.finding === "bug-candidate")
            .map((check) => ({ key: `${screen.scenario}|${check.id}`, text: `[${screen.scenario.slice(policyPrefix.length)}] ${check.title} — ${check.message ?? ""}` })),
        ),
    ),
  );
}

/** 피그마에 없는 문구. 화면마다 한 근거로 묶는다(문구 여러 개) */
function designDiffs(runs: readonly DeviceRun[], names: readonly string[]) {
  const byPath = new Map<string, Set<string>>();
  for (const diff of runs.flatMap((run) => designDiffsOf(run, names))) byPath.set(diff.path, (byPath.get(diff.path) ?? new Set()).add(diff.text.replace(/\s+/g, " ").slice(0, 60)));
  return [...byPath].map(([path, texts]) => ({ key: `design|${path}`, text: `[${path}] 피그마에 없는 문구 ${texts.size}개: ${[...texts].slice(0, 6).map((text) => `「${text}」`).join(" ")}` }));
}

/** 지난 기록 → 분석 입력. 같은 문제는 묶어 「N번」으로, 근거 번호를 붙인다. names는 거를 QA 계정 이름 */
export function buildDailyInput(
  runs: readonly DeviceRun[],
  bots: readonly ChaosRun[],
  window: { from: string; to: string },
  previous: string[] = [],
  skipped: string[] = [],
  names: readonly string[] = [],
): DailyInput {
  const screens = runs.flatMap((run) => run.outcomes.flatMap((outcome) => outcome.screens));
  const flows = screens.filter((screen) => screen.scenario.startsWith(flowPrefix));
  const numbered = (prefix: string, groups: Group[]): Evidence[] =>
    groups.map((item, index) => ({ id: `${prefix}${index + 1}`, text: item.text, count: item.count, ...(item.screenshot ? { screenshot: item.screenshot } : {}) }));
  const policy = group(policyBugs(runs));
  const design = group(designDiffs(runs, names));
  const evidence = [...numbered("R", group(runFailures(runs))), ...numbered("B", group(botErrors(bots))), ...numbered("P", policy), ...numbered("D", design)]
    .sort((a, b) => b.count - a.count)
    .slice(0, maxEvidence);
  return {
    ...window,
    stats: {
      runs: runs.length,
      screens: screens.length,
      failedScreens: screens.filter((screen) => screen.status === "failed").length,
      flowsPassed: flows.filter((screen) => screen.status === "passed").length,
      flows: flows.length,
      botRuns: bots.length,
      botSteps: bots.reduce((sum, run) => sum + run.steps.length, 0),
      botErrorSteps: bots.reduce((sum, run) => sum + run.steps.filter((step) => step.errors.length > 0).length, 0),
      policyBugs: policy.length,
      designDiffs: design.length,
      builds: [...new Set(runs.map((run) => `${run.kind} ${run.outcomes[0]?.device.appVersion ?? run.version}`))],
    },
    evidence,
    previous,
    skipped,
  };
}

export const isEmptyInput = (input: DailyInput) => input.stats.runs === 0 && input.stats.botRuns === 0;

/** Claude에게 줄 글. 스크린샷 경로는 결과 폴더(resultsRoot) 기준으로 붙인다 */
export function dailyPrompt(input: DailyInput, resultsRoot: string, appName?: string): string {
  const stats = input.stats;
  const lines = input.evidence.map(
    (item) => `${item.id} (${item.count}번) ${item.text}${item.screenshot ? `\n   스크린샷: ${resultsRoot}/${item.screenshot}` : ""}`,
  );
  return [
    `너는 ${appName ? `${appName} 앱` : "점검 대상 앱"} QA 담당이다. 실기기 자동 점검(디바이스팜) 기록을 읽고 사람이 확인할 문제만 골라 한국어로 보고한다.`,
    `기간: ${input.from} ~ ${input.to}`,
    `숫자: 점검 ${stats.runs}번(화면 ${stats.screens}개, 실패 ${stats.failedScreens}개), 플로우 ${stats.flowsPassed}/${stats.flows} 통과, 봇 점검 ${stats.botRuns}번 ${stats.botSteps}스텝 중 오류 ${stats.botErrorSteps}스텝, 정책 버그 후보 ${stats.policyBugs}개, 피그마와 다른 화면 ${stats.designDiffs}곳, 빌드 ${stats.builds.join(", ") || "없음"}`,
    input.skipped.length > 0 ? `건너뛴 야간 점검: ${input.skipped.join(" / ")}` : "",
    input.previous.length > 0 ? `어제 보고한 문제: ${input.previous.join(" / ")}` : "어제 보고한 문제: 없음",
    "",
    "근거(번호로만 가리킨다):",
    ...(lines.length > 0 ? lines : ["(없음)"]),
    "",
    "판단 기준:",
    "- app-bug: 앱 동작 오류(누르면 오류, 화면 안 열림, 값이 틀림). data: 관리자·서버 데이터 문제(배너 링크에 HTML, 빈 목록). design: 화면 깨짐·디자인(넘침·겹침·흰 화면). unverified: 사람이 실기기에서 봐야 맞는지 아는 후보(정책·피그마 문구가 화면에 없다는 P 근거는 화면을 직접 확인하기 전까지 여기). farm-false-positive: 점검 도구 판정 오류(로딩 중에 잼, 같은 화면 안 펼침을 반응 없음으로 봄). flaky: 한 번만 나고 근거가 약함.",
    "- 슬랙에서 한눈에 읽게 짧게 쓴다: summary는 한 문장 80자 안, title은 40자 안(무엇이 어디서), action은 「누가 무엇을」 50자 안, stable은 60자 안. 경로·runId·근거 번호는 title·action에 쓰지 않는다(근거 번호는 evidence에만).",
    "- D(피그마에 없는 문구)는 화면이 피그마 시안과 다르게 구현됐을 수 있다는 뜻이다. 시트·팝업·목록 필터처럼 피그마 프레임에 없는 다른 상태의 문구, 시세·상품명·가격 같은 서버 데이터면 farm-false-positive, 버튼·제목·안내 문구가 시안과 다르면 design으로 둔다.",
    "- 같은 원인은 한 항목으로 묶는다. 근거 번호가 없는 주장은 쓰지 않는다. 추측이면 action에 「확인 필요」라고 쓴다.",
    "- new: 어제 보고한 문제에 없으면 true.",
    "- 스크린샷이 있으면 Read로 열어 봐도 된다. 다른 파일은 열지 않는다.",
    "",
    '아래 JSON 하나만 출력한다(설명 없이): {"summary":"한 줄","issues":[{"title":"…","kind":"app-bug|data|design|farm-false-positive|flaky","evidence":["R1"],"action":"누가 무엇을","new":true}],"stable":"통과한 것 한 줄"}',
  ]
    .filter((line) => line !== "")
    .join("\n");
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

/** Claude 답 → 분석. JSON을 못 읽으면 던진다. 근거 번호가 입력에 없거나 비면 그 항목은 버린다 */
export function parseDailyAnalysis(raw: string, input: DailyInput): DailyAnalysis {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("분석 답에 JSON이 없습니다.");
  const parsed: unknown = JSON.parse(raw.slice(start, end + 1));
  if (!isRecord(parsed)) throw new Error("분석 답이 객체가 아닙니다.");
  const ids = new Set(input.evidence.map((item) => item.id));
  const issues = (Array.isArray(parsed.issues) ? parsed.issues : []).flatMap((item): DailyIssue[] => {
    if (!isRecord(item) || typeof item.title !== "string" || !issueKinds.includes(item.kind as IssueKind)) return [];
    const evidence = (Array.isArray(item.evidence) ? item.evidence : []).filter((id): id is string => typeof id === "string" && ids.has(id));
    if (evidence.length === 0) return [];
    return [{ title: item.title, kind: item.kind as IssueKind, evidence, action: typeof item.action === "string" ? item.action : "", new: item.new !== false }];
  });
  return { summary: typeof parsed.summary === "string" ? parsed.summary : "", issues, stable: typeof parsed.stable === "string" ? parsed.stable : "" };
}

/** 사람이 고칠 문제가 아닌 분류(슬랙 아래쪽에 짧게) */
const noiseKinds: readonly IssueKind[] = ["unverified", "farm-false-positive", "flaky"];

const numbers = (stats: DailyStats) =>
  `플로우 ${stats.flowsPassed}/${stats.flows} 통과 · 실패 화면 ${stats.failedScreens} · 봇 ${stats.botSteps}스텝 오류 ${stats.botErrorSteps} · 정책 버그 후보 ${stats.policyBugs}`;

const issueLine = (issue: DailyIssue) => `• [${issueKindLabels[issue.kind]}] ${issue.title}${issue.action ? ` — ${issue.action}` : ""} (${issue.evidence.join(", ")})`;

/**
 * 슬랙 글. 분석이 없으면(실패) 숫자만 담고 이유를 붙인다. 기록이 비면 점검이 돌지 않았다고 쓴다.
 * 진짜 문제(앱·데이터·디자인)를 새로/이어지는 것으로 나누고, 오탐·일시적은 아래에 짧게.
 */
export function dailySlackText(input: DailyInput, analysis: DailyAnalysis | null, title: string, failure?: string): string {
  const head = `:clipboard: *디바이스팜 아침 요약 · ${title}*${input.stats.builds.length > 0 ? ` · ${input.stats.builds.join(", ")}` : ""}`;
  if (isEmptyInput(input)) {
    return [head, `어젯밤 점검이 돌지 않았어요.${input.skipped.length > 0 ? ` (${input.skipped.join(" / ")})` : ""}`].join("\n");
  }
  const lines = [head, numbers(input.stats)];
  if (!analysis) {
    lines.push(`:warning: 분석 실패: ${failure ?? "알 수 없음"}`);
    if (input.evidence.length > 0) lines.push(...input.evidence.slice(0, 5).map((item) => `• ${item.text.slice(0, 200)}${item.count > 1 ? ` (${item.count}번)` : ""}`));
    return lines.join("\n");
  }
  if (analysis.summary) lines.push(analysis.summary);
  const real = analysis.issues.filter((issue) => !noiseKinds.includes(issue.kind));
  const noise = analysis.issues.filter((issue) => !real.includes(issue));
  const fresh = real.filter((issue) => issue.new);
  const ongoing = real.filter((issue) => !issue.new);
  if (real.length === 0) lines.push(":white_check_mark: 확인할 문제 없음");
  if (fresh.length > 0) lines.push("", "*진짜 문제 (새로)*", ...fresh.map(issueLine));
  if (ongoing.length > 0) lines.push("", "*이어지는 문제*", ...ongoing.map(issueLine));
  if (noise.length > 0) lines.push("", "*오탐·일시적*", ...noise.map(issueLine));
  if (analysis.stable) lines.push("", `:large_green_circle: ${analysis.stable}`);
  return lines.join("\n");
}

/** 아침 분석 시각(서버 로컬)·늦게 켜졌을 때 보내는 창 (작성자 판단: 점심 전까지) */
export const dailyReportHour = 9;
export const dailyReportWindowMs = 3 * 60 * 60_000;

/** 로컬 날짜 `YYYY-MM-DD` */
export const localDay = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

const weekdays = ["일", "월", "화", "수", "목", "금", "토"];
/** 슬랙 제목용 `11/13(금)` */
export const dayTitle = (date: Date) => `${date.getMonth() + 1}/${date.getDate()}(${weekdays[date.getDay()]})`;

/**
 * 지금 보낼 아침 분석의 날(로컬 날짜). 평일 09:00이 지났고 창 안이며 그날 분석이 아직 없을 때만.
 * 주말은 보내지 않는다. 월요일 분석은 금요일 분석 뒤 기록 전부를 본다(호출하는 쪽이 since를 정한다).
 */
export function dailyReportDue(now: Date, hasReport: (day: string) => boolean): string | null {
  const scheduled = new Date(now.getFullYear(), now.getMonth(), now.getDate(), dailyReportHour, 0, 0, 0);
  if (now.getTime() < scheduled.getTime() || now.getTime() - scheduled.getTime() > dailyReportWindowMs) return null;
  if (scheduled.getDay() === 0 || scheduled.getDay() === 6) return null;
  const day = localDay(scheduled);
  return hasReport(day) ? null : day;
}

/** 결과에 붙일 보는 기간 `11/11 17:07 ~ 11/12 17:30` (서버 로컬 시간) */
function period(input: DailyInput): string {
  const short = (iso: string) => {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? iso : `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  };
  return `${short(input.from)} ~ ${short(input.to)}`;
}

const mrkdwn = (text: string) => ({ type: "mrkdwn", text });
const section = (text: string) => ({ type: "section", text: mrkdwn(text) });
const context = (...texts: string[]) => ({ type: "context", elements: texts.map(mrkdwn) });

/** 문제 한 개: 굵은 제목 + 다음 줄 할 일·근거 수 */
const issueBlockLine = (issue: DailyIssue) =>
  `• *${issue.title}*  \`${issueKindLabels[issue.kind]}\`\n      ↳ ${issue.action || "확인 필요"} · 근거 ${issue.evidence.length}건`;

/**
 * 슬랙 Block Kit 메시지. 머리 → 숫자 네 칸 → 한 줄 요약 → 새 문제 / 이어지는 문제 → 작게: 확인 필요·오탐·통과.
 * text는 알림 미리보기용 한 줄이다.
 */
export function dailySlackMessage(input: DailyInput, analysis: DailyAnalysis | null, title: string, failure?: string): { text: string; blocks: unknown[] } {
  const stats = input.stats;
  const headText = `디바이스팜 아침 요약 · ${title}`;
  const blocks: unknown[] = [{ type: "header", text: { type: "plain_text", text: `:clipboard: ${headText}` } }, context(`${stats.builds.join(" · ") || "빌드 없음"}  |  ${period(input)}`)];
  if (isEmptyInput(input)) {
    blocks.push(section(`:zzz: 어젯밤 점검이 돌지 않았어요.${input.skipped.length > 0 ? `\n${input.skipped.map((line) => `• ${line}`).join("\n")}` : ""}`));
    return { text: `${headText} — 점검이 돌지 않았어요`, blocks };
  }
  blocks.push({
    type: "section",
    fields: [
      mrkdwn(`*플로우*\n${stats.flowsPassed} / ${stats.flows} 통과`),
      mrkdwn(`*봇 점검*\n${stats.botSteps}스텝 · 오류 ${stats.botErrorSteps}`),
      mrkdwn(`*실패 화면*\n${stats.failedScreens}개`),
      mrkdwn(`*정책 버그 후보*\n${stats.policyBugs}개`),
      mrkdwn(`*피그마와 다른 화면*\n${stats.designDiffs ?? 0}곳`),
    ],
  });
  if (!analysis) {
    blocks.push({ type: "divider" }, section(`:warning: *분석 실패*\n${failure ?? "알 수 없음"}`));
    if (input.evidence.length > 0) blocks.push(context(...input.evidence.slice(0, 5).map((item) => `• ${item.text.slice(0, 150)}${item.count > 1 ? ` (${item.count}번)` : ""}`)));
    return { text: `${headText} — 분석 실패`, blocks };
  }
  if (analysis.summary) blocks.push(section(`> ${analysis.summary}`));
  blocks.push({ type: "divider" });
  const real = analysis.issues.filter((issue) => !noiseKinds.includes(issue.kind));
  const fresh = real.filter((issue) => issue.new);
  const ongoing = real.filter((issue) => !issue.new);
  if (real.length === 0) blocks.push(section(":white_check_mark: *고칠 문제 없음*"));
  if (fresh.length > 0) blocks.push(section([`:red_circle: *새로 생긴 문제 ${fresh.length}*`, ...fresh.map(issueBlockLine)].join("\n")));
  if (ongoing.length > 0) blocks.push(section([`:large_orange_circle: *이어지는 문제 ${ongoing.length}*`, ...ongoing.map(issueBlockLine)].join("\n")));
  const unverified = analysis.issues.filter((issue) => issue.kind === "unverified");
  if (unverified.length > 0) blocks.push(section([`:large_yellow_circle: *확인 필요 ${unverified.length}* — 실기기에서 직접 봐야 해요`, ...unverified.map((issue) => `• ${issue.title}`)].join("\n")));
  const noise = analysis.issues.filter((issue) => issue.kind === "farm-false-positive" || issue.kind === "flaky");
  const footer = [
    ...(noise.length > 0 ? [`:white_circle: 오탐·일시적 ${noise.length}: ${noise.map((issue) => issue.title).join(" / ")}`] : []),
    ...(analysis.stable ? [`:large_green_circle: ${analysis.stable}`] : []),
    ...(input.skipped.length > 0 ? [`:zzz: ${input.skipped.join(" / ")}`] : []),
  ];
  if (footer.length > 0) blocks.push({ type: "divider" }, context(...footer));
  return { text: `${headText} — ${fresh.length > 0 ? `새 문제 ${fresh.length}` : "새 문제 없음"}`, blocks };
}

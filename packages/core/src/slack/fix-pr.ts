/**
 * 오류 알림의 「수정 PR 만들기」 버튼과 그 결과 문구(packages/engine/src/fix-pr/specs/README.md).
 * 버튼 처리·git·Claude는 engine·server가 한다. 여기는 메시지·프롬프트·PR 글만 만든다.
 */

import type { DesignAlert } from "./design-alert";
import { failureTypeLabels, type FailureAlert } from "./failure-alert";
import { statusButtons, type AlertStatusInfo } from "./policy-alert";

/** 버튼 action_id. value에 알림 키를 담는다 */
export const fixPrActionId = "alert_fix_pr";

export type FixPrState = "running" | "opened" | "no-change" | "failed";

export interface FixPrLink {
  base: string;
  number: number;
  url: string;
}

/** 앱에서 못 고친 이유: 디바이스팜 점검기 오탐 · 서버·데이터·기기 · 확실하지 않음 */
export type NoFixCategory = "farm" | "server" | "unsure";

/** 디바이스팜 오탐이면 이 맥의 디바이스팜 체크아웃 main을 바로 고쳐 커밋한다 */
export type FarmFixState = "running" | "committed" | "no-change" | "reverted";

export interface FarmFixInfo {
  state: FarmFixState;
  commit?: string;
  files?: string[];
  /** GitHub origin main에 올렸는지 */
  pushed?: boolean;
  /** 요약·되돌린 이유 */
  note?: string;
  /** 시나리오 파일(scenarioFilePattern)만 고쳤다. 서버를 다시 켜지 않고 그 플로우를 다시 돌려 본다 */
  scenario?: boolean;
  /** 고친 플로우를 다시 돌린 결과 */
  recheck?: { state: "running" | "passed" | "failed"; runId?: string; note?: string };
}

export interface FixPrInfo {
  state: FixPrState;
  /** 누른 사람 슬랙 id */
  by?: string;
  at?: string;
  prs?: FixPrLink[];
  /** no-change·failed 이유, 또는 opened에서 건너뛴 base 이유 */
  note?: string;
  /** no-change일 때 이유 분류 */
  category?: NoFixCategory;
  /** 디바이스팜 오탐을 디바이스팜에서 고친 결과 */
  farm?: FarmFixInfo;
}

/** 수정 PR을 만들 수 있는 알림 */
export type FixableAlert = FailureAlert | DesignAlert;

/** 다시 누를 수 있는 상태(아직 안 누름·못 고침·실패) */
export const canStartFix = (fix?: FixPrInfo) => !fix || fix.state === "no-change" || fix.state === "failed";

export function fixPrButton(key: string): unknown {
  return { type: "button", action_id: fixPrActionId, text: { type: "plain_text", text: "수정 PR 만들기" }, value: key };
}

/**
 * 알림 아래 버튼 줄: 처리 상태 버튼(「확인 필요」일 때)과 PR 버튼(`fixPr`이고 다시 누를 수 있을 때).
 * 둘 다 없으면 줄을 넣지 않는다.
 */
export function alertActionBlocks(key: string, status: AlertStatusInfo, fixPr: boolean): unknown[] {
  const statusElements = status.status === "open" ? (statusButtons(key) as { elements: unknown[] }).elements : [];
  const elements = [...statusElements, ...(fixPr && canStartFix(status.fix) ? [fixPrButton(key)] : [])];
  return elements.length > 0 ? [{ type: "actions", block_id: "policy_alert_status", elements }] : [];
}

const shortNote = (note: string | undefined) => (note ?? "").replace(/\s+/g, " ").slice(0, 150);

/** 디바이스팜 고치기 한 줄. 없으면 null */
export const recheckLabels = { running: "다시 돌려 보는 중", passed: "다시 돌려 통과", failed: "다시 돌려도 실패" } as const;

export function farmFixLine(farm: FarmFixInfo | undefined): string | null {
  if (!farm) return null;
  switch (farm.state) {
    case "running":
      return ":wrench: 디바이스팜 오탐 — 점검 로직·시나리오 고치는 중";
    case "committed": {
      const what = farm.scenario ? "시나리오를" : "점검 로직을";
      const recheck = farm.recheck ? ` · ${recheckLabels[farm.recheck.state]}` : "";
      return `:white_check_mark: 디바이스팜 오탐 — ${what} 고쳐 main에 커밋했어요 \`${(farm.commit ?? "").slice(0, 7)}\`${farm.pushed === false ? " (GitHub에는 못 올림)" : ""}${recheck}`;
    }
    case "no-change":
      return `:warning: 디바이스팜 오탐 — 점검 로직·시나리오는 그대로예요${farm.note ? ` (${shortNote(farm.note)})` : ""}`;
    case "reverted":
      return `:x: 디바이스팜 오탐 — 고친 것을 되돌렸어요 (${shortNote(farm.note) || "검사 실패"})`;
  }
}

/** 상태 줄에 붙이는 PR 진행 한 줄. 없으면 null */
export function fixPrLine(fix: FixPrInfo | undefined): string | null {
  if (!fix) return null;
  switch (fix.state) {
    case "running":
      return `:hammer_and_wrench: 수정 PR 만드는 중${fix.by ? ` · <@${fix.by}>` : ""}`;
    case "opened": {
      const links = (fix.prs ?? []).map((pr) => `<${pr.url}|${pr.base} #${pr.number}>`).join(" · ");
      return `:white_check_mark: 수정 PR: ${links}${fix.note ? ` (${shortNote(fix.note)})` : ""}`;
    }
    case "no-change":
      return `:warning: 수정 PR 없음 — ${shortNote(fix.note) || "고칠 곳을 못 찾았어요"}`;
    case "failed":
      return `:x: 수정 PR 실패 — ${shortNote(fix.note) || "알 수 없음"}`;
  }
}

/** 상태 줄 context 블록에 넣을 PR 줄(없으면 빈 배열) */
export const fixPrContext = (status: AlertStatusInfo): unknown[] => {
  const lines = [fixPrLine(status.fix), farmFixLine(status.fix?.farm)].filter((line): line is string => line !== null);
  return lines.length > 0 ? [{ type: "context", elements: lines.map((text) => ({ type: "mrkdwn", text })) }] : [];
};

/** FNV-1a 32비트, 16진 8자 */
function hash8(text: string): string {
  let value = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value.toString(16).padStart(8, "0");
}

const pad = (value: number) => String(value).padStart(2, "0");

/** `farm-fix/<YYYYMMDD-HHmm>-<해시 8자>` (현지 시각) */
export function fixBranchName(key: string, now: Date): string {
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `farm-fix/${stamp}-${hash8(key)}`;
}

const isDesignAlert = (alert: FixableAlert): alert is DesignAlert => alert.type === "design";

/** 유형 이름(이모지 없이) */
export const fixAlertLabel = (alert: FixableAlert) => (isDesignAlert(alert) ? "디자인 오류" : failureTypeLabels[alert.finding].replace(/^:[a-z_]+: /, ""));

/** 알림 내용(프롬프트·PR 본문 공용) */
function alertDetails(alert: FixableAlert): string[] {
  const lines = [`- 유형: ${fixAlertLabel(alert)}`, `- 점검: ${alert.path}`, `- 빌드·기기: ${alert.build} · ${alert.device}`, `- 점검 id: ${alert.runId}`];
  if (isDesignAlert(alert)) {
    lines.push("- 피그마에 없는 문구(화면에는 있음):");
    for (const screen of alert.screens) {
      lines.push(`  - 화면 \`${screen.path}\`${screen.figmaUrls.length > 0 ? ` (피그마 ${screen.figmaUrls.join(", ")})` : ""}`);
      for (const text of screen.texts) lines.push(`    - 「${text.replace(/\s+/g, " ")}」`);
    }
  } else {
    lines.push(`- 실패 내용: ${alert.message || "-"}`);
  }
  return lines;
}

export interface FixPromptInput {
  repo: string;
  /** 점검 대상 앱 이름(`AppConfig.name`). 프롬프트에 레포가 무엇인지 알려 준다 */
  appName?: string;
  base: string;
  /** 스크린샷·로그가 있는 점검 결과 폴더(절대 경로). 없으면 null */
  resultsDir: string | null;
  /** 실패 화면 스크린샷·로그 폴더(절대 경로) */
  screenshot?: string;
  logDir?: string;
}

/** 고치기 Claude에게 주는 프롬프트. 첫 줄 `NO_FIX`면 못 고침으로 본다 */
export function fixPrompt(alert: FixableAlert, input: FixPromptInput): string {
  const evidence = [
    input.screenshot ? `- 실패 스크린샷: ${input.screenshot}` : null,
    input.logDir ? `- 실패 로그 폴더: ${input.logDir} (앱 로그·네트워크·화면 트리)` : null,
    input.resultsDir ? `- 이 점검 결과 전체: ${input.resultsDir}` : null,
  ].filter((line): line is string => line !== null);
  return [
    `너는 ${input.repo} 레포(${input.appName ? `${input.appName} ` : ""}앱의 웹 프론트, 앱 웹뷰로 뜬다)의 \`${input.base}\` 브랜치 작업 트리에 있다.`,
    "디바이스팜(기기 QA 팜)이 실제 기기 점검에서 아래 오류를 찾았다. 원인이 이 레포 코드에 있으면 고쳐라.",
    "",
    "## 오류",
    ...alertDetails(alert),
    "",
    "## 근거 파일 (읽기만)",
    ...(evidence.length > 0 ? evidence : ["- 없음"]),
    "",
    "## 규칙",
    "- 레포의 CLAUDE.md·규칙 문서가 있으면 먼저 읽고 따른다.",
    "- 원인에 맞는 가장 작은 수정만 한다. 관련 없는 정리·이름 바꾸기·포맷팅을 하지 않는다.",
    "- 설정·의존성·CI·테스트 기준 파일(package.json, lock 파일, .env, 스냅샷)은 건드리지 않는다.",
    "- 근거 파일 폴더에는 쓰지 않는다.",
    "- 원인이 이 레포가 아니거나 확신이 없으면 아무 파일도 바꾸지 말고, 답 첫 줄을 아래 중 하나로 쓴 뒤 다음 줄부터 이유를 쓴다.",
    "  - `NO_FIX farm`: 앱은 맞게 동작하는데 디바이스팜 점검기가 잘못 판정했거나, 디바이스팜 시나리오(누를 버튼 이름·단계)가 바뀐 앱 화면을 못 따라왔다. 이유에 점검기가 무엇을 잘못 봤는지, 시나리오가 낡았으면 지금 앱의 실제 버튼 글자·경로·누르는 순서를 이 레포 코드에서 찾아 쓴다.",
    "  - `NO_FIX server`: 서버·데이터·기기·계정 쪽 문제다.",
    "  - `NO_FIX unsure`: 근거가 모자라 판단하지 못했다.",
    "",
    "## 답",
    "한국어로 5줄 안: 원인, 고친 파일과 내용, 사람이 확인할 것. 이 답이 PR 본문에 들어간다.",
  ].join("\n");
}

export const fixCommitMessage = (alert: FixableAlert) => `fix: ${fixAlertLabel(alert)} · ${alert.path}`;

export const fixPrTitle = (alert: FixableAlert, base: string, firstBase: string) =>
  `${base === firstBase ? "" : "[hotfix] "}fix: ${fixAlertLabel(alert)} · ${alert.path}`.slice(0, 250);

export interface FixPrBodyInput {
  summary: string;
  /** 디바이스팜 주소(`FARM_PUBLIC_ORIGIN`) */
  farmOrigin?: string;
  /** 같은 수정의 다른 base PR */
  related?: FixPrLink[];
}

export function fixPrBody(alert: FixableAlert, input: FixPrBodyInput): string {
  return [
    "디바이스팜 슬랙 오류 알림의 「수정 PR 만들기」로 Claude Code가 만든 수정이에요. 사람이 확인하고 머지해 주세요.",
    "",
    "## 오류",
    ...alertDetails(alert),
    ...(input.farmOrigin ? [`- 실패 화면·영상·로그: ${input.farmOrigin} 결과 탭`] : []),
    "",
    "## Claude 요약",
    input.summary.trim() || "-",
    ...((input.related ?? []).length > 0 ? ["", "## 같은 수정", ...(input.related ?? []).map((pr) => `- ${pr.base}: ${pr.url}`)] : []),
  ].join("\n");
}

/** Claude 답이 「못 고침」인지 */
export const isNoFix = (answer: string) => /^\s*NO_FIX/.test(answer);

/** `NO_FIX <분류>` 답에서 분류와 이유. 못 고침이 아니면 null. 분류가 없거나 모르면 unsure */
export function parseNoFix(answer: string): { category: NoFixCategory; reason: string } | null {
  const match = /^\s*NO_FIX\b[\s:：—–-]*(farm|server|unsure)?[\s:：—–-]*([\s\S]*)$/i.exec(answer);
  if (!match) return null;
  const category = (match[1]?.toLowerCase() as NoFixCategory | undefined) ?? "unsure";
  return { category, reason: match[2].trim() };
}

export interface FarmFixPromptInput {
  /** 앱 쪽 Claude가 오탐이라고 본 이유 */
  reason: string;
  resultsDir: string | null;
  screenshot?: string;
  logDir?: string;
  /** 다른 작업이 고치고 있는(커밋 안 된) 파일. 건드리면 되돌린다 */
  busyFiles: readonly string[];
  /** 앱 웹 프론트 체크아웃(읽기만). 시나리오를 고칠 때 실제 버튼 글자를 찾는다 */
  frontRoot?: string;
  /** 디바이스팜이 기기에서 실제로 본 화면별 버튼(화면 지도) 요약 */
  screenMap?: string;
}

/** 시나리오 파일. 이 아래만 바뀌었으면 「시나리오를 고침」이고 서버를 다시 켜지 않아도 다음 점검에 반영된다 */
export const scenarioFilePattern = /^scenarios\/flows\/[^/]+\.json$/;

/** 디바이스팜 점검 로직을 고치는 Claude 프롬프트. 첫 줄 `NO_FIX`면 고치지 않음 */
export function farmFixPrompt(alert: FixableAlert, input: FarmFixPromptInput): string {
  const evidence = [
    input.screenshot ? `- 실패 스크린샷: ${input.screenshot}` : null,
    input.logDir ? `- 실패 로그 폴더: ${input.logDir}` : null,
    input.resultsDir ? `- 이 점검 결과 전체: ${input.resultsDir}` : null,
  ].filter((line): line is string => line !== null);
  return [
    "너는 디바이스팜(기기 QA 팜) 레포의 작업 트리(main에서 떼어 낸 것)에 있다. 이 폴더 안의 파일만 고친다. 검사를 통과하면 서버가 main에 얹는다.",
    "디바이스팜이 아래 오류를 슬랙에 알렸는데, 앱 프론트 코드를 본 Claude가 「앱은 맞고 디바이스팜 점검기가 잘못 판정했다(오탐)」고 했다.",
    "원인에 따라 둘 중 하나를 고쳐 이런 오탐이 다시 나오지 않게 하라. 진짜 버그는 계속 잡혀야 한다.",
    "1. 점검기 판정 로직이 틀렸으면 판정 로직을 고친다.",
    "2. 판정은 맞는데 시나리오가 낡았으면(앱 화면이 바뀌어 버튼 이름·단계가 달라짐) 그 시나리오를 지금 앱에 맞게 고친다.",
    "   - 플로우 시나리오는 `scenarios/flows/<id>.json`(형식: `packages/core/src/flows/schema.ts`, 플로우 이름 = 파일의 `name`). 실패한 플로우 파일만 고치고 `id`·`name`·`status`·`source`는 그대로 둔다.",
    "   - 버튼 글자는 짐작하지 말고 근거에서 찾는다: 실패 스크린샷, 앱 쪽 Claude가 쓴 이유, 아래 화면 지도, 앱 프론트 코드.",
    "   - 앱에서 그 기능이 없어졌으면 시나리오를 지우지 말고 `NO_FIX`로 이유를 쓴다(사람이 정한다).",
    "",
    "## 오류",
    ...alertDetails(alert),
    "",
    "## 앱 쪽 Claude가 본 오탐 이유",
    input.reason.trim() || "-",
    "",
    "## 근거 파일 (읽기만)",
    ...(evidence.length > 0 ? evidence : ["- 없음"]),
    ...(input.frontRoot ? [`- 앱 웹 프론트 코드: ${input.frontRoot}`] : []),
    ...(input.screenMap ? ["", "## 화면 지도 (디바이스팜이 기기에서 실제로 본 버튼)", input.screenMap] : []),
    "",
    "## 규칙",
    "- CLAUDE.md와 `.claude/rules/`를 먼저 읽고 따른다. 판정 값·문구가 바뀌면 그 모듈의 `specs/`도 같이 고친다.",
    "- 판정을 고치면 그 판정의 `*.test.ts`에 이번 오탐 사례를 넣는다(통과해야 하는 것)와, 진짜 오류는 여전히 잡는 사례를 넣는다.",
    "- 가장 작은 수정만. 관련 없는 정리를 하지 않는다.",
    "- `.env`, `package.json`, lock 파일, `test-results/`, `.claude/`는 건드리지 않는다.",
    ...(input.busyFiles.length > 0 ? ["- 아래 파일은 다른 작업이 고치는 중이라 건드리지 않는다(건드리면 반영되지 않는다). 이 폴더에 있는 것은 그 작업 전 내용이다:", ...input.busyFiles.map((file) => `  - ${file}`)] : []),
    "- 오탐이 아니라고 보이거나, 판정을 고치면 진짜 버그를 놓칠 것 같거나, 확신이 없으면 아무 파일도 바꾸지 말고 답 첫 줄을 `NO_FIX`로 시작한 뒤 이유를 쓴다.",
    "- 끝나면 서버가 타입 검사와 고친 폴더의 테스트를 돌린다. 실패하면 전부 되돌린다.",
    "",
    "## 답",
    "한국어로 5줄 안: 점검기가 무엇을 잘못 봤는지(또는 시나리오의 무엇이 낡았는지), 고친 파일과 내용. 이 답이 커밋 메시지와 슬랙에 들어간다.",
  ].join("\n");
}

export const farmFixCommitMessage = (alert: FixableAlert, summary: string, scenario = false) =>
  [(scenario ? `fix: 시나리오를 지금 앱에 맞춘다 — ${alert.path}` : `fix: ${fixAlertLabel(alert)} 오탐을 줄인다 — ${alert.path}`).slice(0, 120), "", summary.trim(), "", "디바이스팜 슬랙 「수정 PR 만들기」에서 앱 쪽이 오탐으로 판단해 자동으로 고침.", "", "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"].join("\n");

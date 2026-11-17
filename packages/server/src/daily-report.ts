import { nightlySlots } from "@device-farm/core/nightly/schedule";
import { buildDailyInput, dailyPrompt, dailyReportDue, dailySlackMessage, dayTitle, isEmptyInput, parseDailyAnalysis, type DailyAnalysis } from "@device-farm/core/report/daily";
import { readChaosRunsSince } from "@device-farm/engine/chaos/results";
import { readNightly } from "@device-farm/engine/nightly-store";
import { askClaude, type AskClaude } from "@device-farm/engine/policy/claude";
import { readDailyReport, readPreviousReport, writeDailyReport, type DailyReport } from "@device-farm/engine/report/daily-store";
import { readRunsSince } from "@device-farm/engine/results";
import { testResultsRoot } from "@device-farm/engine/run";
import { createSlackClient, type SlackClient } from "@device-farm/engine/slack/client";

/** 아침 분석 시각이 됐는지 보는 간격 (작성자 판단) */
export const dailyReportPollMs = 5 * 60_000;
/** 앞 분석이 없을 때 보는 기간 */
const defaultLookbackMs = 24 * 60 * 60_000;

export interface DailyReportDeps {
  /** 프롬프트에 넣을 앱 이름(`AppConfig.name`) */
  appName?: string;
  log: (message: string) => void;
  now?: () => Date;
  ask?: AskClaude;
  /** 없으면 SLACK_BOT_TOKEN으로 만든다. 토큰도 없으면 저장만 한다 */
  slack?: SlackClient | null;
  channel?: string;
}

const slackFromEnv = (): SlackClient | null => {
  const token = process.env.SLACK_BOT_TOKEN?.trim();
  return token ? createSlackClient(token) : null;
};

/** 기간 안에 건너뛴 야간 점검과 이유 */
function skippedNightly(since: string): string[] {
  return nightlySlots.flatMap((slot) => {
    const record = readNightly(slot.kind);
    return record && record.result === "skipped" && record.scheduledAt >= since ? [`${slot.label}: ${record.note}`] : [];
  });
}

/**
 * 하루치 아침 분석을 만들어 저장하고 슬랙에 보낸다(docs/operations.md). 같은 날 다시 부르면 저장을 덮어쓰고 슬랙 글을 고친다.
 * Claude가 실패해도 숫자 요약과 이유는 보낸다. 슬랙은 send가 true일 때만.
 */
export async function runDailyReport(day: string, deps: DailyReportDeps & { send: boolean }): Promise<DailyReport> {
  const now = deps.now?.() ?? new Date();
  const previous = readPreviousReport(day);
  const since = previous?.createdAt ?? new Date(now.getTime() - defaultLookbackMs).toISOString();
  const previousTitles = (previous?.analysis?.issues ?? []).filter((issue) => issue.kind !== "farm-false-positive" && issue.kind !== "flaky").map((issue) => issue.title);
  const names = (process.env.FARM_ACCOUNT_NAME ?? "").split(",").map((name) => name.trim()).filter(Boolean);
  const input = buildDailyInput(readRunsSince(since), readChaosRunsSince(since), { from: since, to: now.toISOString() }, previousTitles, skippedNightly(since), names);

  let analysis: DailyAnalysis | null = null;
  let failure: string | undefined;
  if (!isEmptyInput(input)) {
    try {
      analysis = parseDailyAnalysis(await (deps.ask ?? askClaude)(dailyPrompt(input, testResultsRoot, deps.appName), { allowRead: true }), input);
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
      // 토큰이 풀리면 claude가 로그인 안내로 실패한다. 고칠 방법을 같이 적는다
      if (/log ?in|logged in|auth|token|로그인/i.test(failure)) failure += " — 호스트에서 `claude setup-token` 뒤 .env CLAUDE_CODE_OAUTH_TOKEN 교체";
      deps.log(`아침 분석 Claude 실패: ${failure}`);
    }
  }

  const existing = readDailyReport(day);
  const report: DailyReport = { day, createdAt: now.toISOString(), input, analysis, ...(failure ? { failure } : {}), channel: existing?.channel, ts: existing?.ts };
  const { text, blocks } = dailySlackMessage(input, analysis, dayTitle(new Date(`${day}T00:00:00`)), failure);
  const slack = deps.slack === undefined ? slackFromEnv() : deps.slack;
  const channel = deps.channel ?? process.env.SLACK_CHANNEL_DEV?.trim();
  if (deps.send && slack && channel) {
    try {
      if (report.ts && report.channel) await slack.update(report.channel, report.ts, text, blocks);
      else Object.assign(report, await slack.post(channel, text, blocks));
    } catch (error) {
      deps.log(`아침 분석 슬랙 실패: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  writeDailyReport(report);
  deps.log(`아침 분석 ${day}: 근거 ${input.evidence.length}개 · 문제 ${analysis?.issues.length ?? "분석 실패"}`);
  return report;
}

/** 평일 09:00(창 3시간)에 한 번 아침 분석을 돌린다. 서버 안 타이머(정책·야간 점검과 같은 방식) */
export function startDailyReports(deps: DailyReportDeps): { stop: () => void } {
  let running = false;
  const tick = () => {
    const now = deps.now?.() ?? new Date();
    const day = dailyReportDue(now, (candidate) => readDailyReport(candidate) !== null);
    if (!day || running) return;
    running = true;
    runDailyReport(day, { ...deps, send: true })
      .catch((error: unknown) => deps.log(`아침 분석 실패: ${error instanceof Error ? error.message : String(error)}`))
      .finally(() => {
        running = false;
      });
  };
  tick();
  const timer = setInterval(tick, dailyReportPollMs);
  return { stop: () => clearInterval(timer) };
}


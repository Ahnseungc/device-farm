import { useState } from "react";
import { HStack, Text, VStack } from "@seed-design/react";

import type { DeviceRun } from "@device-farm/core/device/types";
import { issueKinds, openCounts, type IssueKind } from "@device-farm/core/issues/issue";
import type { DailyIssue } from "@device-farm/core/report/daily";

import { api, errorMessage, usePoll, type DailyReportView } from "./api-client";
import { FloatingNotice } from "./floating-notice";
import { dateLocale, t } from "./i18n";
import { dailyKindLabel, issueKindLabel } from "./issue-labels";
import { MetaLine } from "./meta-line";
import { StaggeredEntrance, StaggeredEntranceItem } from "./motion/StaggeredEntrance";
import { ActionButton } from "./seed-design/ui/action-button";
import { Badge } from "./seed-design/ui/badge";
import { Callout } from "./seed-design/ui/callout";
import { DialogBody, DialogContent, DialogRoot } from "./seed-design/ui/dialog";
import "./today.css";

/** 오늘 화면 데이터는 자주 바뀌지 않는다 (작성자 판단) */
const todayPollMs = 10_000;

const noiseKinds: readonly DailyIssue["kind"][] = ["unverified", "farm-false-positive", "flaky"];

const shortTime = (iso: string | null | undefined) => {
  if (!iso) return t("진행 중", "Running");
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString(dateLocale(), { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
};

/** 실행 버튼 셋: 플로우 점검·봇 점검·새 빌드 점검(기기 화면으로) */
function QuickActions({ onOpenDevices }: { onOpenDevices: () => void }) {
  const [busy, setBusy] = useState<"flows" | "bot" | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const run = async (kind: "flows" | "bot") => {
    setBusy(kind);
    setMessage(null);
    try {
      if (kind === "flows") await api.startRun({ kind: "dev", devices: "all", flowsOnly: true });
      else await api.startBot();
      setMessage({ text: kind === "flows"
          ? t("플로우 점검을 시작했어요. 오른쪽 아래에서 진행을 볼 수 있어요.", "Flow check started. Track progress in the bottom right.")
          : t("봇 점검을 시작했어요(기기마다 30분).", "Bot check started (30 minutes per device)."), error: false });
    } catch (error) {
      setMessage({ text: errorMessage(error), error: true });
    } finally {
      setBusy(null);
    }
  };
  return (
    <VStack gap="x2">
      <HStack gap="x2" wrap="wrap">
        <ActionButton variant="brandSolid" size="medium" loading={busy === "flows"} disabled={busy !== null} onClick={() => void run("flows")}>
          {t("플로우 점검", "Flow check")}
        </ActionButton>
        <ActionButton variant="neutralWeak" size="medium" loading={busy === "bot"} disabled={busy !== null} onClick={() => void run("bot")}>
          {t("봇 점검", "Bot check")}
        </ActionButton>
        <ActionButton variant="neutralWeak" size="medium" onClick={onOpenDevices}>
          {t("새 빌드 점검…", "Check a new build…")}
        </ActionButton>
      </HStack>
      <FloatingNotice notice={message} onClose={() => setMessage(null)} />
    </VStack>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="today-stat">
      <Text textStyle="t3Regular" color="fg.neutralMuted">
        {label}
      </Text>
      <Text textStyle="t6Bold">{value}</Text>
    </div>
  );
}

function IssueLine({ issue }: { issue: DailyIssue }) {
  return (
    <li className="today-issue">
      <HStack gap="x1_5" align="center" wrap="wrap">
        <Badge tone={issue.kind === "app-bug" ? "critical" : issue.kind === "data" ? "warning" : "informative"} variant="weak">
          {dailyKindLabel(issue.kind)}
        </Badge>
        <Text textStyle="t4Medium">{issue.title}</Text>
      </HStack>
      {issue.action ? (
        <Text textStyle="t3Regular" color="fg.neutralMuted">
          {issue.action}
        </Text>
      ) : null}
    </li>
  );
}

/** 아침 요약(Claude). 슬랙에 올린 것과 같은 내용 */
function MorningReport({ report }: { report: DailyReportView | null | undefined }) {
  if (report === undefined) return null;
  if (!report) {
    return (
      <section className="today-card" aria-label={t("아침 요약", "Morning summary")}>
        <Text as="h2" textStyle="t5Bold">
          {t("아침 요약", "Morning summary")}
        </Text>
        <Text textStyle="t3Regular" color="fg.neutralMuted">
          {t(
            "아직 분석이 없어요. 평일 09:00에 지난 점검 기록을 Claude가 읽고 여기와 슬랙에 올려요.",
            "No analysis yet. On weekdays at 09:00, Claude reads the recent check history and posts a summary here and to Slack.",
          )}
        </Text>
      </section>
    );
  }
  const stats = report.input.stats;
  const issues = report.analysis?.issues ?? [];
  const real = issues.filter((issue) => !noiseKinds.includes(issue.kind));
  const rest = issues.filter((issue) => noiseKinds.includes(issue.kind));
  return (
    <section className="today-card" aria-label={t("아침 요약", "Morning summary")}>
      <HStack gap="x2" align="center" justify="space-between" wrap="wrap">
        <Text as="h2" textStyle="t5Bold">
          {t(`${report.day} 아침 요약`, `Morning summary · ${report.day}`)}
        </Text>
        <Text textStyle="t3Regular" color="fg.neutralSubtle">
          <MetaLine items={stats.builds} />
        </Text>
      </HStack>
      <div className="today-stats">
        <Stat label={t("플로우", "Flows")} value={t(`${stats.flowsPassed}/${stats.flows} 통과`, `${stats.flowsPassed}/${stats.flows} passed`)} />
        <Stat label={t("봇 점검", "Bot check")} value={t(`오류 ${stats.botErrorSteps} / ${stats.botSteps}스텝`, `${stats.botErrorSteps} errors / ${stats.botSteps} steps`)} />
        <Stat label={t("정책 버그 후보", "Policy bug candidates")} value={t(`${stats.policyBugs}개`, `${stats.policyBugs}`)} />
        <Stat label={t("피그마와 다른 화면", "Screens differing from Figma")} value={t(`${stats.designDiffs ?? 0}곳`, `${stats.designDiffs ?? 0}`)} />
      </div>
      {report.analysis?.summary ? <blockquote className="today-summary">{report.analysis.summary}</blockquote> : null}
      {!report.analysis ? <Callout tone="warning" description={`${t("분석 실패", "Analysis failed")}: ${report.failure ?? t("알 수 없음", "unknown")}`} /> : null}
      {real.length > 0 ? (
        <VStack gap="x2">
          <Text textStyle="t4Bold">{`${t("고칠 문제", "To fix")} ${real.length}`}</Text>
          <ul className="today-issues">
            {real.map((issue) => (
              <IssueLine key={issue.title} issue={issue} />
            ))}
          </ul>
        </VStack>
      ) : report.analysis ? (
        <Text textStyle="t4Medium">{t("고칠 문제 없음", "Nothing to fix")}</Text>
      ) : null}
      {rest.length > 0 ? (
        <details className="today-more">
          <summary>{`${t("확인 필요·오탐", "Needs review · false positives")} ${rest.length}`}</summary>
          <ul className="today-issues">
            {rest.map((issue) => (
              <IssueLine key={issue.title} issue={issue} />
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

/** 남은 문제 수. 누르면 「문제」에서 그 유형만 */
function OpenIssues({ onOpen }: { onOpen: (kind: IssueKind | null) => void }) {
  const issues = usePoll(api.issues, todayPollMs);
  const counts = openCounts(issues.data ?? []);
  const total = issueKinds.reduce((sum, kind) => sum + counts[kind], 0);
  return (
    <section className="today-card" aria-label={t("남은 문제", "Open problems")}>
      <HStack gap="x2" align="center" justify="space-between">
        <Text as="h2" textStyle="t5Bold">
          {`${t("남은 문제", "Open problems")} ${total}`}
        </Text>
        <ActionButton variant="ghost" size="small" onClick={() => onOpen(null)}>
          {t("전체 보기", "View all")}
        </ActionButton>
      </HStack>
      <div className="today-kinds">
        {issueKinds.map((kind) => (
          <button key={kind} type="button" className="today-kind" onClick={() => onOpen(kind)} disabled={counts[kind] === 0}>
            <Text textStyle="t3Regular" color="fg.neutralMuted">
              {issueKindLabel(kind)}
            </Text>
            <Text textStyle="t6Bold" color={counts[kind] > 0 ? "fg.neutral" : "fg.neutralSubtle"}>
              {counts[kind]}
            </Text>
          </button>
        ))}
      </div>
    </section>
  );
}

function runLine(run: DeviceRun) {
  const screens = run.outcomes.flatMap((outcome) => outcome.screens);
  const failed = screens.filter((screen) => screen.status === "failed").length;
  return <MetaLine items={[run.label ?? (run.trigger === "auto" ? t("자동 점검", "Auto check") : t("점검", "Check")), shortTime(run.startedAt), t(`${screens.length}개 중 실패 ${failed}`, `${failed} of ${screens.length} failed`)]} />;
}

/** 마지막 기기 점검·봇 점검 한 줄씩 */
function RecentRuns({ onOpenRuns }: { onOpenRuns: () => void }) {
  const run = usePoll(api.latestRun, todayPollMs);
  const bots = usePoll(api.chaosRuns, todayPollMs);
  const bot = bots.data?.[0];
  return (
    <section className="today-card" aria-label={t("최근 점검", "Recent checks")}>
      <HStack gap="x2" align="center" justify="space-between">
        <Text as="h2" textStyle="t5Bold">
          {t("최근 점검", "Recent checks")}
        </Text>
        <ActionButton variant="ghost" size="small" onClick={onOpenRuns}>
          {t("점검 기록", "Run history")}
        </ActionButton>
      </HStack>
      <ul className="today-runs">
        <li>{run.data ? runLine(run.data) : t("기기 점검 기록 없음", "No device checks yet")}</li>
        <li>{bot ? <MetaLine items={[t("봇 점검", "Bot check"), shortTime(bot.startedAt), t(`${bot.steps}스텝 중 오류 ${bot.errorSteps}`, `${bot.errorSteps} errors in ${bot.steps} steps`)]} /> : t("봇 점검 기록 없음", "No bot checks yet")}</li>
      </ul>
    </section>
  );
}

interface TodayDialogProps {
  open: boolean;
  onClose: () => void;
  onOpenIssues: (kind: IssueKind | null) => void;
  onOpenRuns: () => void;
  onOpenDevices: () => void;
}

/** 「오늘」: 그날 처음 들어오면 뜨는 요약 — 아침 요약, 남은 문제, 최근 점검, 실행 버튼 */
export function TodayDialog({ open, onClose, onOpenIssues, onOpenRuns, onOpenDevices }: TodayDialogProps) {
  const report = usePoll(api.latestDailyReport, todayPollMs);
  return (
    <DialogRoot open={open} size="large" closeOnInteractOutside onOpenChange={(next) => !next && onClose()}>
      <DialogContent title={t("오늘", "Today")} className="today-dialog">
        <DialogBody>
          <StaggeredEntrance className="today-page">
            <StaggeredEntranceItem>
              <QuickActions onOpenDevices={onOpenDevices} />
            </StaggeredEntranceItem>
            {report.error ? <Callout tone="critical" description={report.error} /> : null}
            <StaggeredEntranceItem>
              <div className="today-grid">
                <MorningReport report={report.data} />
                <VStack gap="x4">
                  <OpenIssues onOpen={onOpenIssues} />
                  <RecentRuns onOpenRuns={onOpenRuns} />
                </VStack>
              </div>
            </StaggeredEntranceItem>
          </StaggeredEntrance>
        </DialogBody>
      </DialogContent>
    </DialogRoot>
  );
}

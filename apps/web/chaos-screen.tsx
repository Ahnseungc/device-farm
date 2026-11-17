import { useEffect, useState } from "react";

import { HStack, Text, VStack } from "@seed-design/react";

import { causesOf, type BotCause } from "@device-farm/core/chaos/causes";
import type { ChaosKind } from "@device-farm/core/chaos/policy";
import type { ChaosRun, ChaosRunSummary, ChaosStep } from "@device-farm/core/chaos/types";

import { api, errorMessage, resultFileUrl, usePoll } from "./api-client";
import { FloatingNotice, type Notice } from "./floating-notice";
import { dateLocale, t } from "./i18n";
import { issueLabel } from "./issue-labels";
import { LoadingState } from "./loading-state";
import { MetaLine } from "./meta-line";
import { StaggeredEntrance, StaggeredEntranceItem } from "./motion/StaggeredEntrance";
import { ActionButton } from "./seed-design/ui/action-button";
import { Badge } from "./seed-design/ui/badge";
import { Callout } from "./seed-design/ui/callout";
import "./chaos.css";

const kindLabels = (): Record<ChaosKind, string> => ({
  press: t("누르기", "Tap"),
  fill: t("입력", "Type"),
  back: t("뒤로", "Back"),
  tab: t("탭", "Tab"),
  doubleTap: t("연타", "Double tap"),
  backDuringLoad: t("로딩 중 뒤로", "Back while loading"),
  background: t("백그라운드", "Background"),
  otherApp: t("다른 앱 다녀오기", "Visit another app"),
  restart: t("재시작", "Restart"),
  homeReset: t("홈 리셋", "Home reset"),
});

/** `종류:역할:이름` → 「연타 · OX퀴즈」 */
function actionLabel(key: string): { kind: string; name: string; chaos: boolean } {
  const [kind, , ...rest] = key.split(":");
  const label = kindLabels()[kind as ChaosKind] ?? kind;
  return { kind: label, name: rest.join(":"), chaos: kind !== "press" && kind !== "tab" };
}

const percent = (value: number) => `${Math.round(value * 100)}%`;
const time = (iso: string) => new Date(iso).toLocaleTimeString(dateLocale(), { hour: "2-digit", minute: "2-digit" });

function StepDetail({ run, step }: { run: ChaosRun; step: ChaosStep }) {
  return (
    <div className="chaos-detail">
      <VStack gap="x1_5">
        <Text textStyle="t3Bold" color="fg.neutralMuted">{t("후보 점수 (높은 순)", "Candidate scores (highest first)")}</Text>
        {step.candidates.map((candidate) => {
          const label = actionLabel(candidate.key);
          const picked = candidate.key === step.chosen || step.chosen.startsWith(candidate.key);
          return (
            <div key={candidate.key} className={picked ? "chaos-cand chaos-cand-picked" : "chaos-cand"}>
              <Text textStyle="t3Regular" className="chaos-cand-name"><MetaLine items={[label.kind, label.name]} /></Text>
              <div className="chaos-cand-track" aria-hidden="true">
                <div className="chaos-cand-fill" style={{ width: percent(candidate.probability) }} />
              </div>
              <Text textStyle="t3Regular" className="chaos-cand-value"><MetaLine items={[percent(candidate.probability), candidate.score]} /></Text>
            </div>
          );
        })}
      </VStack>
      {step.errors.length > 0 ? (
        <VStack gap="x1">
          <Text textStyle="t3Bold" color="fg.critical">{t(`오류 ${step.errors.length}`, `Errors ${step.errors.length}`)}</Text>
          <ul className="chaos-issues">
            {step.errors.map((issue, index) => (
              <li key={index}>
                <Text textStyle="t3Regular"><MetaLine items={[issue.kind, issue.message]} /></Text>
              </li>
            ))}
          </ul>
        </VStack>
      ) : null}
      {step.warnings.length > 0 ? <Text textStyle="t3Regular" color="fg.neutralSubtle">{`${t("레이아웃 경고", "Layout warnings")} ${step.warnings.length}: ${step.warnings.map((issue) => issue.kind).join(", ")}`}</Text> : null}
      {step.failure ? <Text textStyle="t3Regular" color="fg.critical">{`${t("행동 실패", "Action failed")}: ${step.failure}`}</Text> : null}
      {step.screenshot ? <img className="chaos-shot" src={resultFileUrl(`chaos/${run.runId}/${step.screenshot}`)} alt={t(`${step.episode}회차 ${step.step}스텝 화면`, `Episode ${step.episode} step ${step.step} screen`)} /> : null}
    </div>
  );
}

function StepRow({ run, step }: { run: ChaosRun; step: ChaosStep }) {
  const [open, setOpen] = useState(false);
  const action = actionLabel(step.chosen);
  const moved = step.to !== step.from;
  return (
    <li className={step.errors.length > 0 ? "chaos-step chaos-step-error" : "chaos-step"}>
      <button type="button" className="chaos-step-head" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span className="chaos-step-no">{step.step}</span>
        <span className="chaos-step-flow">
          <Text textStyle="t3Regular" color="fg.neutralSubtle" className="chaos-path">{step.from}</Text>
          <span className={action.chaos ? "chaos-action chaos-action-chaos" : "chaos-action"}>
            <Text textStyle="t3Bold"><MetaLine items={[action.kind, action.name]} /></Text>
            <Text textStyle="t2Regular" color="fg.neutralSubtle">{percent(step.chosenProbability)}</Text>
          </span>
          <Text textStyle="t3Regular" className="chaos-path">{moved ? t(`이동: ${step.to}`, `Moved to: ${step.to}`) : t("같은 화면 그대로", "Stayed on the same screen")}</Text>
        </span>
        <HStack gap="x1" wrap="wrap" className="chaos-step-badges">
          {step.newState ? <Badge tone="positive" variant="weak">{t("새 상태", "New state")}</Badge> : null}
          {step.dead ? <Badge tone="neutral" variant="weak">{t("반응 없음", "No response")}</Badge> : null}
          {step.failure ? <Badge tone="warning" variant="weak">{t("실패", "Failed")}</Badge> : null}
          {step.errors.length > 0 ? <Badge tone="critical" variant="weak">{t(`오류 ${step.errors.length}`, `Errors ${step.errors.length}`)}</Badge> : null}
        </HStack>
      </button>
      {open ? <StepDetail run={run} step={step} /> : null}
    </li>
  );
}

/** 실행 목록 한 줄: 날짜·시각 · 눌러 본 수 · 오류 */
/** 끝 기록 없이 이만큼 지난 실행은 강제로 끝난 것으로 본다(진행 중 플로팅과 같은 기준) */
const staleRunMs = 2 * 60 * 60_000;

function RunItem({ run, selected, onSelect }: { run: ChaosRunSummary; selected: boolean; onSelect: () => void }) {
  const stopped = !run.finishedAt && Date.now() - Date.parse(run.startedAt) > staleRunMs;
  return (
    <button type="button" className="bot-run" aria-current={selected ? "true" : undefined} onClick={onSelect}>
      {/* 220px 칸에 날짜와 배지를 한 줄로 두면 배지가 잘려(「오류 단…」) 날짜만 위에, 배지는 요약과 같은 줄에 둔다 */}
      <Text textStyle="t4Bold" className="bot-run-date">{`${new Date(run.startedAt).toLocaleDateString(dateLocale(), { month: "numeric", day: "numeric" })} ${time(run.startedAt)}`}</Text>
      <HStack gap="x1_5" align="center" wrap="wrap">
        {run.finishedAt ? (
          run.errorSteps > 0 ? (
            <Badge tone="critical" variant="weak">{t(`오류 단계 ${run.errorSteps}`, `${run.errorSteps} error steps`)}</Badge>
          ) : (
            <Badge tone="positive" variant="weak">{t("깨끗해요", "Clean")}</Badge>
          )
        ) : stopped ? (
          <Badge tone="neutral" variant="weak">{t("중단됨", "Stopped")}</Badge>
        ) : (
          <Badge tone="informative" variant="weak">{t("도는 중", "Running")}</Badge>
        )}
        <Text textStyle="t3Regular" color="fg.neutralSubtle">{t(`${run.steps}번 눌러 화면 ${run.states}개`, `${run.steps} taps, ${run.states} screens`)}</Text>
      </HStack>
    </button>
  );
}

/** 원인 카드: 무엇이 문제인지(제목) · 처음 나온 화면 · 몇 번 · 어떤 신호로 · 그때 화면 */
function CauseCard({ run, cause }: { run: ChaosRun; cause: BotCause }) {
  return (
    <article className={`bot-error${cause.level === "note" ? " bot-error-note" : ""}`}>
      <VStack gap="x1_5" className="bot-error-body">
        <Text textStyle="t5Bold">{cause.title}</Text>
        <Text textStyle="t3Regular" color="fg.neutralMuted">
          <MetaLine items={[t(`처음 나온 화면 ${cause.firstScreen}`, `First seen on ${cause.firstScreen}`), t(`${cause.count}번`, `${cause.count}×`), cause.signals.map(issueLabel).join(" + ")]} />
        </Text>
        {cause.screens.length > 1 ? (
          <Text textStyle="t3Regular" color="fg.neutralSubtle">
            {t(`나온 화면: ${cause.screens.join(", ")}`, `Seen on: ${cause.screens.join(", ")}`)}
          </Text>
        ) : null}
        <Text textStyle="t3Regular" color="fg.neutralSubtle" className="bot-error-message">
          {cause.detail}
        </Text>
      </VStack>
      {cause.screenshot ? <img className="bot-error-shot" src={resultFileUrl(`chaos/${run.runId}/${cause.screenshot}`)} alt={t(`${cause.firstScreen} 그때 화면`, `${cause.firstScreen} at that moment`)} /> : null}
    </article>
  );
}

/** Claude 한 줄 원인 요약. 끝난 실행은 자동으로 붙고, 예전 실행은 버튼으로 만든다 */
function SummaryLine({ run }: { run: ChaosRun }) {
  const summary = usePoll(() => api.botSummary(run.runId), 15_000);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const make = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.summarizeBot(run.runId);
      await summary.reload();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };
  if (summary.data) return <blockquote className="bot-summary">{summary.data.text}</blockquote>;
  return (
    <HStack gap="x2" align="center" wrap="wrap" className="bot-summary-empty">
      <ActionButton variant="neutralWeak" size="small" loading={busy} disabled={busy || !run.finishedAt} onClick={() => void make()}>
        {t("Claude로 원인 한 줄 정리", "Summarize the cause with Claude")}
      </ActionButton>
      <Text textStyle="t3Regular" color={error ? "fg.critical" : "fg.neutralSubtle"}>
        {error ?? (run.finishedAt ? t("1분쯤 걸려요", "Takes about a minute") : t("끝나면 저절로 정리해요", "Summarized automatically when the run ends"))}
      </Text>
    </HStack>
  );
}

function RunView({ run }: { run: ChaosRun }) {
  const episodes = [...new Set(run.steps.map((step) => step.episode))];
  const causes = causesOf(run);
  const problems = causes.filter((cause) => cause.level === "problem");
  const notes = causes.filter((cause) => cause.level === "note");
  const dead = run.steps.filter((step) => step.dead).length;
  return (
    <VStack gap="x5" className="bot-detail">
      <section className="bot-hero" aria-label={t("실행 요약", "Run summary")}>
        <Text as="h2" textStyle="t6Bold">
          {problems.length > 0
            ? t(`${run.steps.length}번 눌러 보고 고칠 문제 ${problems.length}가지를 찾았어요`, `Found ${problems.length} problem(s) to fix in ${run.steps.length} taps`)
            : t(`${run.steps.length}번 눌러 봤는데 고칠 문제가 없었어요`, `No problems to fix in ${run.steps.length} taps`)}
        </Text>
        <SummaryLine key={run.runId} run={run} />
        <Text textStyle="t3Regular" color="fg.neutralSubtle">
          <MetaLine items={[
              run.deviceId,
              t(`${time(run.startedAt)} 시작`, `Started ${time(run.startedAt)}`),
              run.finishedAt ? t(`${time(run.finishedAt)} 끝`, `Finished ${time(run.finishedAt)}`) : t("도는 중", "Running"),
              t(`시드 ${run.seed}`, `Seed ${run.seed}`),
            ]} />
        </Text>
        <div className="bot-stats">
          {[
            [t("처음 본 화면", "New screens"), String(run.states)],
            [t("오류가 난 단계", "Steps with errors"), String(run.steps.filter((step) => step.errors.length > 0).length)],
            [t("반응 없음", "No response"), String(dead)],
            [t("막은 쓰기 요청", "Blocked write requests"), String(run.blocked.length)],
          ].map(([label, value]) => (
            <div key={label} className="bot-stat">
              <Text textStyle="t3Regular" color="fg.neutralSubtle">{label}</Text>
              <Text textStyle="t5Bold">{value}</Text>
            </div>
          ))}
        </div>
      </section>

      {problems.length > 0 ? (
        <VStack gap="x3">
          <Text as="h3" textStyle="t5Bold">{t(`고칠 문제 ${problems.length}`, `Problems to fix ${problems.length}`)}</Text>
          <StaggeredEntrance className="bot-errors">
            {problems.map((cause) => (
              <StaggeredEntranceItem key={cause.key}>
                <CauseCard run={run} cause={cause} />
              </StaggeredEntranceItem>
            ))}
          </StaggeredEntrance>
        </VStack>
      ) : null}

      {notes.length > 0 ? (
        <details className="bot-episode">
          <summary className="bot-episode-head">
            <Text textStyle="t4Bold">{t(`참고 ${notes.length}`, `Notes ${notes.length}`)}</Text>
            <Text textStyle="t3Regular" color="fg.neutralSubtle">{t("개발 빌드 경고·SDK 로그처럼 바로 고칠 문제는 아닌 것", "Things like dev-build warnings and SDK logs that don't need fixing right away")}</Text>
          </summary>
          <div className="bot-errors bot-notes">
            {notes.map((cause) => (
              <CauseCard key={cause.key} run={run} cause={cause} />
            ))}
          </div>
        </details>
      ) : null}

      <VStack gap="x3">
        <Text as="h3" textStyle="t5Bold">{t("돌아다닌 길", "Path taken")}</Text>
        <Text textStyle="t3Regular" color="fg.neutralSubtle">
          {t("단계를 누르면 그때 고를 수 있던 행동과 확률을 볼 수 있어요.", "Click a step to see the actions it could pick and their odds.")}
        </Text>
        {episodes.map((episode, index) => {
          const steps = run.steps.filter((step) => step.episode === episode);
          const errors = steps.filter((step) => step.errors.length > 0).length;
          return (
            <details key={episode} className="bot-episode" open={index === 0 && episodes.length === 1}>
              <summary className="bot-episode-head">
                <Text textStyle="t4Bold">{t(`${episode}회차`, `Episode ${episode}`)}</Text>
                <Text textStyle="t3Regular" color="fg.neutralSubtle">{t(`${steps.length}단계`, `${steps.length} steps`)}</Text>
                {errors > 0 ? <Badge tone="critical" variant="weak">{t(`오류 ${errors}`, `Errors ${errors}`)}</Badge> : null}
              </summary>
              <ol className="chaos-steps">
                {steps.map((step) => (
                  <StepRow key={`${step.episode}-${step.step}`} run={run} step={step} />
                ))}
              </ol>
            </details>
          );
        })}
      </VStack>

      {run.blocked.length > 0 ? (
        <details className="bot-episode">
          <summary className="bot-episode-head">
            <Text textStyle="t4Bold">{t(`막은 쓰기 요청 ${run.blocked.length}건`, `Blocked write requests ${run.blocked.length}`)}</Text>
            <Text textStyle="t3Regular" color="fg.neutralSubtle">{t("봇이 데이터를 바꾸지 못하게 막은 요청이에요", "Requests blocked so the bot can't change data")}</Text>
          </summary>
          <ul className="chaos-issues bot-blocked">
            {[...new Set(run.blocked)].map((line) => (
              <li key={line}>
                <Text textStyle="t3Regular">{line}</Text>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </VStack>
  );
}

/** 「봇 점검」: 봇이 앱을 무작위로 눌러 보며 찾은 오류. 왼쪽 실행 목록, 오른쪽 찾은 오류 → 돌아다닌 길 */
export function ChaosScreen() {
  const runs = usePoll(api.chaosRuns);
  const [selected, setSelected] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [starting, setStarting] = useState(false);
  const runId = selected ?? runs.data?.[0]?.runId ?? null;
  const run = usePoll(() => (runId ? api.chaosRun(runId) : Promise.resolve(null)));

  useEffect(() => {
    void run.reload();
    // 고른 실행이 바뀌면 바로 다시 읽는다(폴링 주기를 기다리지 않는다).
  }, [runId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function start() {
    setStarting(true);
    try {
      await api.startBot();
      setNotice({ text: t("봇 점검을 시작했어요. 기기마다 30분 돌아요.", "Bot check started. It runs for 30 minutes on each device."), error: false });
      await runs.reload();
      setSelected(null);
    } catch (error) {
      setNotice({ text: errorMessage(error), error: true });
    } finally {
      setStarting(false);
    }
  }

  if (runs.data === undefined) return runs.error ? <Callout tone="critical" description={runs.error} /> : <LoadingState />;
  const current = run.data && run.data.runId === runId ? run.data : null;

  return (
    <VStack gap="x5" className="bot-page">
      <FloatingNotice notice={notice} onClose={() => setNotice(null)} />
      <HStack justify="space-between" align="flex-end" gap="x3" wrap="wrap">
        <VStack gap="x1">
          <Text as="h1" textStyle="t7Bold">
            {t("봇 점검", "Bot check")}
          </Text>
          <Text textStyle="t4Regular" color="fg.neutralMuted">
            {t(
              "봇이 앱을 이리저리 눌러 보며 오류·깨진 화면을 찾아요. 매일 밤 03:30에도 돌아요.",
              "A bot taps around the app looking for errors and broken screens. It also runs every night at 03:30.",
            )}
          </Text>
        </VStack>
        <ActionButton variant="brandSolid" size="medium" loading={starting} disabled={starting} onClick={() => void start()}>
          {t("지금 돌리기", "Run now")}
        </ActionButton>
      </HStack>
      {runs.data.length === 0 ? (
        <div className="bot-empty">
          <Text textStyle="t5Bold">{t("아직 돌린 적이 없어요", "No runs yet")}</Text>
          <Text textStyle="t4Regular" color="fg.neutralMuted">
            {t("「지금 돌리기」를 누르면 연결된 기기마다 30분 동안 돌아다녀요.", "Press Run now to explore each connected device for 30 minutes.")}
          </Text>
        </div>
      ) : (
        <div className="bot-layout">
          <nav className="bot-runs" aria-label={t("봇 점검 실행", "Bot check runs")}>
            {runs.data.map((item) => (
              <RunItem key={item.runId} run={item} selected={item.runId === runId} onSelect={() => setSelected(item.runId)} />
            ))}
          </nav>
          {run.error ? <Callout tone="critical" description={run.error} /> : current ? <RunView run={current} /> : <LoadingState />}
        </div>
      )}
    </VStack>
  );
}

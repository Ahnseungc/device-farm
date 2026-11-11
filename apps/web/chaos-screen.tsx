import { useEffect, useState } from "react";

import { HStack, Text, VStack } from "@seed-design/react";

import type { ChaosKind } from "@device-farm/core/chaos/policy";
import type { ChaosRun, ChaosRunSummary, ChaosStep } from "@device-farm/core/chaos/types";

import { api, resultFileUrl, usePoll } from "./api-client";
import { dateLocale, plural, t } from "./i18n";
import { Badge } from "./seed-design/ui/badge";
import { Callout } from "./seed-design/ui/callout";
import { Checkbox } from "./seed-design/ui/checkbox";
import "./chaos.css";

const kindLabels = (): Record<ChaosKind, string> => ({
  press: t("누르기", "Tap"),
  back: t("뒤로", "Back"),
  tab: t("탭", "Tab"),
  doubleTap: t("연타", "Double tap"),
  backDuringLoad: t("로딩 중 뒤로", "Back while loading"),
  background: t("백그라운드", "Background"),
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

function RunPicker({ runs, selected, onSelect }: { runs: ChaosRunSummary[]; selected: string | null; onSelect: (id: string) => void }) {
  return (
    <div className="chaos-runs" role="listbox" aria-label={t("카오스 실행", "Chaos runs")}>
      {runs.map((run) => (
        <button
          key={run.runId}
          type="button"
          role="option"
          aria-selected={run.runId === selected}
          className="chaos-run"
          onClick={() => onSelect(run.runId)}
        >
          <HStack gap="x1_5" align="center">
            <Text textStyle="t4Bold">{`${new Date(run.startedAt).toLocaleDateString(dateLocale())} ${time(run.startedAt)}`}</Text>
            {run.finishedAt ? null : <Badge tone="informative" variant="weak">{t("진행 중", "Running")}</Badge>}
          </HStack>
          <Text textStyle="t3Regular" color="fg.neutralSubtle">{t(`시드 ${run.seed} · 스텝 ${run.steps} · 상태 ${run.states}`, `Seed ${run.seed} · ${plural(run.steps, "step")} · ${plural(run.states, "state")}`)}</Text>
          <HStack gap="x1" wrap="wrap">
            {run.errorSteps > 0 ? <Badge tone="critical" variant="weak">{t(`오류 스텝 ${run.errorSteps}`, `Error steps ${run.errorSteps}`)}</Badge> : <Badge tone="positive" variant="weak">{t("오류 없음", "No errors")}</Badge>}
            {run.blocked > 0 ? <Badge tone="neutral" variant="weak">{t(`막은 쓰기 ${run.blocked}`, `Blocked writes ${run.blocked}`)}</Badge> : null}
          </HStack>
        </button>
      ))}
    </div>
  );
}

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
              <Text textStyle="t3Regular" className="chaos-cand-name">{label.name ? `${label.kind} · ${label.name}` : label.kind}</Text>
              <div className="chaos-cand-track" aria-hidden="true">
                <div className="chaos-cand-fill" style={{ width: percent(candidate.probability) }} />
              </div>
              <Text textStyle="t3Regular" className="chaos-cand-value">{`${percent(candidate.probability)} · ${candidate.score}`}</Text>
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
                <Text textStyle="t3Regular">{`${issue.kind} · ${issue.message}`}</Text>
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
            <Text textStyle="t3Bold">{action.name ? `${action.kind} · ${action.name}` : action.kind}</Text>
            <Text textStyle="t2Regular" color="fg.neutralSubtle">{percent(step.chosenProbability)}</Text>
          </span>
          <Text textStyle="t3Regular" className="chaos-path">{moved ? `→ ${step.to}` : t("→ 같은 화면", "→ same screen")}</Text>
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

function RunView({ run }: { run: ChaosRun }) {
  const [errorsOnly, setErrorsOnly] = useState(false);
  const episodes = [...new Set(run.steps.map((step) => step.episode))];
  const errorSteps = run.steps.filter((step) => step.errors.length > 0).length;
  return (
    <VStack gap="x4">
      <section className="chaos-card" aria-label={t("실행 요약", "Run summary")}>
        <div className="chaos-summary">
          {[
            [t("스텝", "Steps"), run.steps.length],
            [t("처음 본 상태", "New states"), run.states],
            [t("오류 스텝", "Error steps"), errorSteps],
            [t("막은 쓰기", "Blocked writes"), run.blocked.length],
          ].map(([label, value]) => (
            <div key={label} className="chaos-stat">
              <Text textStyle="t3Regular" color="fg.neutralSubtle">{label}</Text>
              <Text textStyle="t6Bold">{String(value)}</Text>
            </div>
          ))}
        </div>
        <Text textStyle="t3Regular" color="fg.neutralSubtle">
          {t(
            `시드 ${run.seed} · ${run.deviceId} · ${time(run.startedAt)} 시작${run.finishedAt ? ` · ${time(run.finishedAt)} 끝` : " · 진행 중(2초마다 새로 읽어요)"}`,
            `Seed ${run.seed} · ${run.deviceId} · started ${time(run.startedAt)}${run.finishedAt ? ` · finished ${time(run.finishedAt)}` : " · running (refreshes every 2s)"}`,
          )}
        </Text>
        <Checkbox label={t("오류 스텝만", "Error steps only")} size="medium" checked={errorsOnly} onCheckedChange={(checked) => setErrorsOnly(checked === true)} />
      </section>
      {episodes.map((episode) => {
        const steps = run.steps.filter((step) => step.episode === episode && (!errorsOnly || step.errors.length > 0));
        return (
          <section key={episode} className="chaos-card" aria-label={t(`${episode}회차`, `Episode ${episode}`)}>
            <Text as="h3" textStyle="t4Bold">{t(`${episode}회차 · ${run.steps.filter((step) => step.episode === episode).length}스텝`, `Episode ${episode} · ${run.steps.filter((step) => step.episode === episode).length} steps`)}</Text>
            {steps.length === 0 ? <Text color="fg.neutralMuted">{t("오류 스텝이 없어요.", "No error steps.")}</Text> : null}
            <ol className="chaos-steps">
              {steps.map((step) => (
                <StepRow key={`${step.episode}-${step.step}`} run={run} step={step} />
              ))}
            </ol>
          </section>
        );
      })}
      {run.blocked.length > 0 ? (
        <section className="chaos-card" aria-label={t("막은 쓰기 요청", "Blocked write requests")}>
          <Text as="h3" textStyle="t4Bold">{t(`막은 쓰기 요청 ${run.blocked.length}`, `Blocked write requests ${run.blocked.length}`)}</Text>
          <ul className="chaos-issues">
            {[...new Set(run.blocked)].map((line) => (
              <li key={line}>
                <Text textStyle="t3Regular">{line}</Text>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </VStack>
  );
}

/** 카오스 탐색 결과: 실행을 고르면 회차별로 화면 → 행동(뽑힌 확률) → 화면 흐름을 보여 준다. */
export function ChaosScreen() {
  const runs = usePoll(api.chaosRuns);
  const [selected, setSelected] = useState<string | null>(null);
  const runId = selected ?? runs.data?.[0]?.runId ?? null;
  const run = usePoll(() => (runId ? api.chaosRun(runId) : Promise.resolve(null)));

  useEffect(() => {
    void run.reload();
    // 고른 실행이 바뀌면 바로 다시 읽는다(폴링 주기를 기다리지 않는다).
  }, [runId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <VStack gap="x4" className="chaos-page">
      <section className="chaos-card" aria-label={t("카오스 실행 목록", "Chaos run list")}>
        <VStack gap="x0_5">
          <Text as="h2" textStyle="t5Bold">{t("카오스 탐색", "Chaos exploration")}</Text>
          <Text textStyle="t3Regular" color="fg.neutralSubtle">
            {t(
              "가중치 무작위로 돌아다닌 기록이에요. 스텝을 누르면 그때 후보 점수와 오류를 볼 수 있어요. 실행은 터미널에서 npm run chaos로 해요.",
              "Records of weighted random walks through the app. Click a step to see the candidate scores and errors at that moment. Start a run from the terminal with npm run chaos.",
            )}
          </Text>
        </VStack>
        {runs.error ? <Callout tone="critical" description={runs.error} /> : null}
        {runs.data && runs.data.length === 0 ? <Text color="fg.neutralMuted">{t("아직 실행이 없어요.", "No runs yet.")}</Text> : null}
        {runs.data && runs.data.length > 0 ? <RunPicker runs={runs.data} selected={runId} onSelect={setSelected} /> : null}
      </section>
      {run.error ? <Callout tone="critical" description={run.error} /> : null}
      {run.data && run.data.runId === runId ? <RunView run={run.data} /> : null}
    </VStack>
  );
}

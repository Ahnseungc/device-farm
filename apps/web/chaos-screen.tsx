import { useEffect, useState } from "react";

import { HStack, Text, VStack } from "@seed-design/react";

import type { ChaosKind } from "@device-farm/core/chaos/policy";
import type { ChaosRun, ChaosRunSummary, ChaosStep } from "@device-farm/core/chaos/types";

import { api, resultFileUrl, usePoll } from "./api-client";
import { Badge } from "./seed-design/ui/badge";
import { Callout } from "./seed-design/ui/callout";
import { Checkbox } from "./seed-design/ui/checkbox";
import "./chaos.css";

const kindLabels = {
  press: "누르기",
  back: "뒤로",
  tab: "탭",
  doubleTap: "연타",
  backDuringLoad: "로딩 중 뒤로",
  background: "백그라운드",
  restart: "재시작",
  homeReset: "홈 리셋",
} as const satisfies Record<ChaosKind, string>;

/** `종류:역할:이름` → 「연타 · OX퀴즈」 */
function actionLabel(key: string): { kind: string; name: string; chaos: boolean } {
  const [kind, , ...rest] = key.split(":");
  const label = kindLabels[kind as ChaosKind] ?? kind;
  return { kind: label, name: rest.join(":"), chaos: kind !== "press" && kind !== "tab" };
}

const percent = (value: number) => `${Math.round(value * 100)}%`;
const time = (iso: string) => new Date(iso).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });

function RunPicker({ runs, selected, onSelect }: { runs: ChaosRunSummary[]; selected: string | null; onSelect: (id: string) => void }) {
  return (
    <div className="chaos-runs" role="listbox" aria-label="카오스 실행">
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
            <Text textStyle="t4Bold">{`${new Date(run.startedAt).toLocaleDateString("ko-KR")} ${time(run.startedAt)}`}</Text>
            {run.finishedAt ? null : <Badge tone="informative" variant="weak">진행 중</Badge>}
          </HStack>
          <Text textStyle="t3Regular" color="fg.neutralSubtle">{`시드 ${run.seed} · 스텝 ${run.steps} · 상태 ${run.states}`}</Text>
          <HStack gap="x1" wrap="wrap">
            {run.errorSteps > 0 ? <Badge tone="critical" variant="weak">{`오류 스텝 ${run.errorSteps}`}</Badge> : <Badge tone="positive" variant="weak">오류 없음</Badge>}
            {run.blocked > 0 ? <Badge tone="neutral" variant="weak">{`막은 쓰기 ${run.blocked}`}</Badge> : null}
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
        <Text textStyle="t3Bold" color="fg.neutralMuted">후보 점수 (높은 순)</Text>
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
          <Text textStyle="t3Bold" color="fg.critical">{`오류 ${step.errors.length}`}</Text>
          <ul className="chaos-issues">
            {step.errors.map((issue, index) => (
              <li key={index}>
                <Text textStyle="t3Regular">{`${issue.kind} · ${issue.message}`}</Text>
              </li>
            ))}
          </ul>
        </VStack>
      ) : null}
      {step.warnings.length > 0 ? <Text textStyle="t3Regular" color="fg.neutralSubtle">{`레이아웃 경고 ${step.warnings.length}: ${step.warnings.map((issue) => issue.kind).join(", ")}`}</Text> : null}
      {step.failure ? <Text textStyle="t3Regular" color="fg.critical">{`행동 실패: ${step.failure}`}</Text> : null}
      {step.screenshot ? <img className="chaos-shot" src={resultFileUrl(`chaos/${run.runId}/${step.screenshot}`)} alt={`${step.episode}회차 ${step.step}스텝 화면`} /> : null}
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
          <Text textStyle="t3Regular" className="chaos-path">{moved ? `→ ${step.to}` : "→ 같은 화면"}</Text>
        </span>
        <HStack gap="x1" wrap="wrap" className="chaos-step-badges">
          {step.newState ? <Badge tone="positive" variant="weak">새 상태</Badge> : null}
          {step.dead ? <Badge tone="neutral" variant="weak">반응 없음</Badge> : null}
          {step.failure ? <Badge tone="warning" variant="weak">실패</Badge> : null}
          {step.errors.length > 0 ? <Badge tone="critical" variant="weak">{`오류 ${step.errors.length}`}</Badge> : null}
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
      <section className="chaos-card" aria-label="실행 요약">
        <div className="chaos-summary">
          {[
            ["스텝", run.steps.length],
            ["처음 본 상태", run.states],
            ["오류 스텝", errorSteps],
            ["막은 쓰기", run.blocked.length],
          ].map(([label, value]) => (
            <div key={label} className="chaos-stat">
              <Text textStyle="t3Regular" color="fg.neutralSubtle">{label}</Text>
              <Text textStyle="t6Bold">{String(value)}</Text>
            </div>
          ))}
        </div>
        <Text textStyle="t3Regular" color="fg.neutralSubtle">
          {`시드 ${run.seed} · ${run.deviceId} · ${time(run.startedAt)} 시작${run.finishedAt ? ` · ${time(run.finishedAt)} 끝` : " · 진행 중(2초마다 새로 읽어요)"}`}
        </Text>
        <Checkbox label="오류 스텝만" size="medium" checked={errorsOnly} onCheckedChange={(checked) => setErrorsOnly(checked === true)} />
      </section>
      {episodes.map((episode) => {
        const steps = run.steps.filter((step) => step.episode === episode && (!errorsOnly || step.errors.length > 0));
        return (
          <section key={episode} className="chaos-card" aria-label={`${episode}회차`}>
            <Text as="h3" textStyle="t4Bold">{`${episode}회차 · ${run.steps.filter((step) => step.episode === episode).length}스텝`}</Text>
            {steps.length === 0 ? <Text color="fg.neutralMuted">오류 스텝이 없어요.</Text> : null}
            <ol className="chaos-steps">
              {steps.map((step) => (
                <StepRow key={`${step.episode}-${step.step}`} run={run} step={step} />
              ))}
            </ol>
          </section>
        );
      })}
      {run.blocked.length > 0 ? (
        <section className="chaos-card" aria-label="막은 쓰기 요청">
          <Text as="h3" textStyle="t4Bold">{`막은 쓰기 요청 ${run.blocked.length}`}</Text>
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
      <section className="chaos-card" aria-label="카오스 실행 목록">
        <VStack gap="x0_5">
          <Text as="h2" textStyle="t5Bold">카오스 탐색</Text>
          <Text textStyle="t3Regular" color="fg.neutralSubtle">
            가중치 무작위로 돌아다닌 기록이에요. 스텝을 누르면 그때 후보 점수와 오류를 볼 수 있어요. 실행은 터미널에서 npm run chaos로 해요.
          </Text>
        </VStack>
        {runs.error ? <Callout tone="critical" description={runs.error} /> : null}
        {runs.data && runs.data.length === 0 ? <Text color="fg.neutralMuted">아직 실행이 없어요.</Text> : null}
        {runs.data && runs.data.length > 0 ? <RunPicker runs={runs.data} selected={runId} onSelect={setSelected} /> : null}
      </section>
      {run.error ? <Callout tone="critical" description={run.error} /> : null}
      {run.data && run.data.runId === runId ? <RunView run={run.data} /> : null}
    </VStack>
  );
}

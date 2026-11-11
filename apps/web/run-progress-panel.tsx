import { useEffect, useState } from "react";
import { HStack, Text, VStack } from "@seed-design/react";

import type { DeviceOutcome, DeviceRun, FlowStepView, OutcomePhase, OutcomeStatus } from "@device-farm/core/device/types";

import { api, errorMessage, usePoll } from "./api-client";
import { ActionButton } from "./seed-design/ui/action-button";
import { Badge, type BadgeProps } from "./seed-design/ui/badge";
import { SidePanelBody, SidePanelContent, SidePanelFooter, SidePanelRoot } from "./seed-design/ui/side-panel";
import "./run-progress-panel.css";

type Tone = NonNullable<BadgeProps["tone"]>;

const phaseLabel = {
  installing: "설치 중",
  waiting_testflight: "TestFlight 업데이트 기다리는 중",
  checking: "점검 중",
} as const satisfies Record<OutcomePhase, string>;

const statusView = {
  running: { label: "진행 중", tone: "informative" },
  passed: { label: "통과", tone: "positive" },
  failed: { label: "실패", tone: "critical" },
  skipped: { label: "건너뜀", tone: "neutral" },
  install_failed: { label: "설치 실패", tone: "warning" },
  login_required: { label: "로그인 필요", tone: "warning" },
  offline: { label: "연결 끊김", tone: "warning" },
} as const satisfies Record<OutcomeStatus, { label: string; tone: Tone }>;

/** 패널에 보여 줄 최근 실패 수 */
const recentFailureCount = 3;

interface RunProgressPanelProps {
  onOpenResults: () => void;
}

/** 점검이 도는 동안 오른쪽에 뜨는 진행 패널. 배경을 막지 않아(non-modal) 기기 화면을 보면서 쓸 수 있다. */
export function RunProgressPanel({ onOpenResults }: RunProgressPanelProps) {
  const latest = usePoll(api.latestRun);
  const run = latest.data ?? null;
  const running = run !== null && run.finishedAt === null;
  const [open, setOpen] = useState(false);
  const [dismissedRunId, setDismissedRunId] = useState<string | null>(null);
  /** 멈추기를 누른 실행. 끝날 때까지 「멈추는 중」으로 둔다. */
  const [stoppingRunId, setStoppingRunId] = useState<string | null>(null);
  const [stopError, setStopError] = useState<string | null>(null);

  // 새 실행이 시작되면 저절로 연다. 사람이 닫은 실행은 다시 열지 않는다.
  useEffect(() => {
    if (running && run.runId !== dismissedRunId) setOpen(true);
  }, [running, run?.runId, dismissedRunId]);

  if (!run) return null;

  const stopping = running && stoppingRunId === run.runId;
  const stop = async () => {
    setStopError(null);
    try {
      await api.stopRun();
      setStoppingRunId(run.runId);
    } catch (error) {
      setStopError(errorMessage(error));
    }
  };

  const close = () => {
    setOpen(false);
    setDismissedRunId(run.runId);
  };

  return (
    <>
      {!open && running ? (
        <button type="button" className="progress-reopen" onClick={() => setOpen(true)}>
          점검 진행 중 · {overallPercent(run)}%
        </button>
      ) : null}
      <SidePanelRoot
        modal={false}
        open={open}
        onOpenChange={(next) => (next ? setOpen(true) : close())}
        direction="right"
        size="small"
      >
        <SidePanelContent
          title={running ? "점검 진행 중" : "점검 끝"}
          description={`${run.kind} ${run.version} · ${run.trigger === "auto" ? "자동" : "수동"} · ${elapsed(run)}`}
        >
          <SidePanelBody paddingX="x6">
            <VStack gap="x4">
              {run.outcomes.length === 0 ? (
                <Text textStyle="t4Regular" color="fg.neutralSubtle">
                  점검할 기기가 없어요.
                </Text>
              ) : null}
              {run.outcomes.map((outcome) => (
                <DeviceProgress key={outcome.device.id} outcome={outcome} total={run.scenarioCount ?? 0} />
              ))}
            </VStack>
          </SidePanelBody>
          <SidePanelFooter>
            {running ? (
              <VStack gap="x1" align="flex-start">
                <ActionButton variant="criticalSolid" disabled={stopping} loading={stopping} onClick={() => void stop()}>
                  {stopping ? "멈추는 중" : "점검 멈추기"}
                </ActionButton>
                {stopping ? (
                  <Text textStyle="t3Regular" color="fg.neutralSubtle">
                    지금 화면·플로우가 끝나면 멈춰요.
                  </Text>
                ) : null}
                {stopError ? (
                  <Text textStyle="t3Regular" color="fg.critical">
                    {stopError}
                  </Text>
                ) : null}
              </VStack>
            ) : null}
            <ActionButton
              variant="neutralWeak"
              onClick={() => {
                close();
                onOpenResults();
              }}
            >
              결과 보기
            </ActionButton>
          </SidePanelFooter>
        </SidePanelContent>
      </SidePanelRoot>
    </>
  );
}

const flowStepMark = { passed: "✓", running: "▶", pending: "·" } as const satisfies Record<FlowStepView["status"], string>;
const flowStepColor = { passed: "fg.positive", running: "fg.neutral", pending: "fg.neutralMuted" } as const satisfies Record<FlowStepView["status"], string>;

function DeviceProgress({ outcome, total }: { outcome: DeviceOutcome; total: number }) {
  const done = outcome.screens.length;
  const percent = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  const failed = outcome.screens.filter((screen) => screen.status === "failed");
  const candidates = outcome.screens.filter((screen) => screen.status === "candidate").length;
  const passed = outcome.screens.filter((screen) => screen.status === "passed").length;
  const view = statusView[outcome.status];

  return (
    <section className="progress-device" aria-label={`${outcome.device.model} 진행 상황`}>
      <HStack gap="x2" align="center" justify="space-between">
        <Text as="h3" textStyle="t5Bold">
          {outcome.device.model} · {outcome.device.osVersion}
        </Text>
        <Badge tone={view.tone} variant="weak">
          {outcome.phase ? phaseLabel[outcome.phase] : view.label}
        </Badge>
      </HStack>

      <div
        className="progress-bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        aria-label="점검한 화면 수"
      >
        <div className="progress-bar-fill" data-failed={failed.length > 0} style={{ width: `${percent}%` }} />
      </div>
      <HStack gap="x3" wrap="wrap">
        <Text textStyle="t3Medium">
          {done} / {total} 화면 · {percent}%
        </Text>
        <Text textStyle="t3Regular" color="fg.positive">
          통과 {passed}
        </Text>
        <Text textStyle="t3Regular" color="fg.informative">
          후보 {candidates}
        </Text>
        <Text textStyle="t3Regular" color="fg.critical">
          실패 {failed.length}
        </Text>
      </HStack>

      {outcome.current ? (
        <Text as="p" textStyle="t3Regular" color="fg.neutralMuted">
          지금: {outcome.current}
        </Text>
      ) : null}
      {outcome.flowSteps ? (
        <ol className="progress-flow-steps" aria-label="지금 플로우 스텝">
          {outcome.flowSteps.map((step, index) => (
            <li key={index} data-status={step.status} aria-current={step.status === "running" ? "step" : undefined}>
              <Text textStyle={step.status === "running" ? "t3Bold" : "t3Regular"} color={flowStepColor[step.status]}>
                {flowStepMark[step.status]} {index + 1}. {step.label}
              </Text>
            </li>
          ))}
        </ol>
      ) : null}
      {outcome.message ? (
        <Text as="p" textStyle="t3Regular" color="fg.neutralMuted">
          {outcome.message}
        </Text>
      ) : null}

      {failed.length > 0 ? (
        <ul className="progress-failures" aria-label="최근 실패">
          {failed.slice(-recentFailureCount).map((screen) => (
            <li key={screen.scenario}>
              <Text textStyle="t3Medium" color="fg.critical">
                {screen.scenario}
              </Text>
              {screen.message ? (
                <Text textStyle="t2Regular" color="fg.neutralSubtle">
                  {screen.message}
                </Text>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function overallPercent(run: DeviceRun): number {
  const total = (run.scenarioCount ?? 0) * run.outcomes.length;
  if (total === 0) return 0;
  const done = run.outcomes.reduce((sum, outcome) => sum + outcome.screens.length, 0);
  return Math.min(100, Math.round((done / total) * 100));
}

function elapsed(run: DeviceRun): string {
  const end = run.finishedAt ? Date.parse(run.finishedAt) : Date.now();
  const seconds = Math.max(0, Math.round((end - Date.parse(run.startedAt)) / 1000));
  const minutes = Math.floor(seconds / 60);
  return minutes > 0 ? `${minutes}분 ${seconds % 60}초` : `${seconds}초`;
}

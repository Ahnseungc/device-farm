import { useEffect, useState } from "react";
import { HStack, Text, VStack } from "@seed-design/react";

import type { DeviceOutcome, DeviceRun, FlowStepView, OutcomePhase, OutcomeStatus } from "@device-farm/core/device/types";

import { api, errorMessage, usePoll } from "./api-client";
import { t } from "./i18n";
import { ActionButton } from "./seed-design/ui/action-button";
import { Badge, type BadgeProps } from "./seed-design/ui/badge";
import { SidePanelBody, SidePanelContent, SidePanelFooter, SidePanelRoot } from "./seed-design/ui/side-panel";
import "./run-progress-panel.css";

type Tone = NonNullable<BadgeProps["tone"]>;

const phaseLabel = (phase: OutcomePhase): string =>
  ({
    installing: t("설치 중", "Installing"),
    waiting_testflight: t("TestFlight 업데이트 기다리는 중", "Waiting for TestFlight update"),
    checking: t("점검 중", "Checking"),
  })[phase];

const statusView = (status: OutcomeStatus): { label: string; tone: Tone } =>
  (({
    running: { label: t("진행 중", "Running"), tone: "informative" },
    passed: { label: t("통과", "Passed"), tone: "positive" },
    failed: { label: t("실패", "Failed"), tone: "critical" },
    skipped: { label: t("건너뜀", "Skipped"), tone: "neutral" },
    install_failed: { label: t("설치 실패", "Install failed"), tone: "warning" },
    login_required: { label: t("로그인 필요", "Login required"), tone: "warning" },
    offline: { label: t("연결 끊김", "Offline"), tone: "warning" },
  }) satisfies Record<OutcomeStatus, { label: string; tone: Tone }>)[status];

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
          {t("점검 진행 중", "Check running")} · {overallPercent(run)}%
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
          title={running ? t("점검 진행 중", "Check running") : t("점검 끝", "Check finished")}
          description={`${run.kind} ${run.version} · ${run.trigger === "auto" ? t("자동", "Auto") : t("수동", "Manual")} · ${elapsed(run)}`}
        >
          <SidePanelBody paddingX="x6">
            <VStack gap="x4">
              {run.outcomes.length === 0 ? (
                <Text textStyle="t4Regular" color="fg.neutralSubtle">
                  {t("점검할 기기가 없어요.", "No devices to check.")}
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
                  {stopping ? t("멈추는 중", "Stopping") : t("점검 멈추기", "Stop check")}
                </ActionButton>
                {stopping ? (
                  <Text textStyle="t3Regular" color="fg.neutralSubtle">
                    {t("지금 화면·플로우가 끝나면 멈춰요.", "Stops after the current screen or flow finishes.")}
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
              {t("결과 보기", "View results")}
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
  const view = statusView(outcome.status);

  return (
    <section className="progress-device" aria-label={t(`${outcome.device.model} 진행 상황`, `${outcome.device.model} progress`)}>
      <HStack gap="x2" align="center" justify="space-between">
        <Text as="h3" textStyle="t5Bold">
          {outcome.device.model} · {outcome.device.osVersion}
        </Text>
        <Badge tone={view.tone} variant="weak">
          {outcome.phase ? phaseLabel(outcome.phase) : view.label}
        </Badge>
      </HStack>

      <div
        className="progress-bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        aria-label={t("점검한 화면 수", "Screens checked")}
      >
        <div className="progress-bar-fill" data-failed={failed.length > 0} style={{ width: `${percent}%` }} />
      </div>
      <HStack gap="x3" wrap="wrap">
        <Text textStyle="t3Medium">
          {done} / {total} {t("화면", "screens")} · {percent}%
        </Text>
        <Text textStyle="t3Regular" color="fg.positive">
          {t("통과", "Passed")} {passed}
        </Text>
        <Text textStyle="t3Regular" color="fg.informative">
          {t("후보", "Candidates")} {candidates}
        </Text>
        <Text textStyle="t3Regular" color="fg.critical">
          {t("실패", "Failed")} {failed.length}
        </Text>
      </HStack>

      {outcome.current ? (
        <Text as="p" textStyle="t3Regular" color="fg.neutralMuted">
          {t("지금", "Now")}: {outcome.current}
        </Text>
      ) : null}
      {outcome.flowSteps ? (
        <ol className="progress-flow-steps" aria-label={t("지금 플로우 스텝", "Current flow steps")}>
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
        <ul className="progress-failures" aria-label={t("최근 실패", "Recent failures")}>
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
  return minutes > 0 ? t(`${minutes}분 ${seconds % 60}초`, `${minutes}m ${seconds % 60}s`) : t(`${seconds}초`, `${seconds}s`);
}

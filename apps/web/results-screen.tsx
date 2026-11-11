import { useState } from "react";
import { HStack, Text, VStack } from "@seed-design/react";

import type { DeviceOutcome, DeviceRun, DeviceScreen, OutcomeStatus, ScreenStatus } from "@device-farm/core/device/types";

import { api, usePoll } from "./api-client";
import { FailureDetail } from "./failure-detail";
import { Badge, type BadgeProps } from "./seed-design/ui/badge";
import { Callout } from "./seed-design/ui/callout";
import { ProgressCircle } from "./seed-design/ui/progress-circle";
import { ResultSection } from "./seed-design/ui/result-section";
import "./results.css";

type CellStatus = ScreenStatus | OutcomeStatus;

const cellLabel = {
  passed: "통과",
  failed: "실패",
  candidate: "기준 후보",
  login_required: "로그인 필요",
  running: "진행 중",
  skipped: "건너뜀",
  install_failed: "설치 실패",
  offline: "연결 끊김",
} as const satisfies Record<CellStatus, string>;

type BadgeLook = Pick<BadgeProps, "tone" | "variant">;

const cellBadge = {
  passed: { tone: "positive", variant: "weak" },
  failed: { tone: "critical", variant: "weak" },
  candidate: { tone: "informative", variant: "weak" },
  login_required: { tone: "warning", variant: "weak" },
  running: { tone: "informative", variant: "outline" },
  skipped: { tone: "neutral", variant: "weak" },
  install_failed: { tone: "warning", variant: "weak" },
  offline: { tone: "warning", variant: "weak" },
} as const satisfies Record<CellStatus, BadgeLook>;

const triggerLabel = { manual: "수동", auto: "자동" } as const satisfies Record<DeviceRun["trigger"], string>;

const triggerTone = { manual: "neutral", auto: "informative" } as const satisfies Record<
  DeviceRun["trigger"],
  BadgeProps["tone"]
>;

export type FailedCell = { outcome: DeviceOutcome; screen: DeviceScreen };

function scenarioRows(run: DeviceRun): string[] {
  const names: string[] = [];
  for (const outcome of run.outcomes) {
    for (const screen of outcome.screens) if (!names.includes(screen.scenario)) names.push(screen.scenario);
  }
  return names;
}

function formatTime(value: string | null): string {
  return value ? new Date(value).toLocaleString("ko-KR") : "진행 중";
}

export function ResultsScreen() {
  const latest = usePoll(api.latestRun);
  const [failed, setFailed] = useState<FailedCell | null>(null);
  const run = latest.data;

  return (
    <VStack gap="x4" className="results-page">
      {latest.error ? <Callout tone="critical" description={latest.error} /> : null}
      {latest.data === undefined && !latest.error ? (
        <HStack gap="x2" justify="center" py="x8">
          <ProgressCircle aria-label="불러오는 중" />
          <Text color="fg.neutralMuted">불러오는 중</Text>
        </HStack>
      ) : null}
      {latest.data === null ? (
        <div className="results-card">
          <ResultSection
            size="medium"
            title="아직 점검한 기록이 없어요"
            description="기기 화면에서 점검을 돌리면 결과가 여기에 보여요."
          />
        </div>
      ) : null}
      {run ? <RunTable run={run} onFailed={setFailed} /> : null}
      {failed ? <FailureDetail cell={failed} onClose={() => setFailed(null)} /> : null}
    </VStack>
  );
}

interface RunTableProps {
  run: DeviceRun;
  onFailed: (cell: FailedCell) => void;
}

function RunTable({ run, onFailed }: RunTableProps) {
  const rows = scenarioRows(run);
  const messages = run.outcomes.filter((outcome) => outcome.message);
  return (
    <section className="results-card" aria-label="최근 점검 결과">
      <div className="results-head">
        <HStack gap="x2" align="center" wrap="wrap">
          <Text as="h2" textStyle="t5Bold">
            {run.kind} {run.version}
          </Text>
          <Badge tone={triggerTone[run.trigger]} variant="weak">
            {triggerLabel[run.trigger]}
          </Badge>
        </HStack>
        <Text as="p" textStyle="t3Regular" color="fg.neutralSubtle">
          {formatTime(run.startedAt)} → {formatTime(run.finishedAt)}
        </Text>
      </div>
      {run.outcomes.length === 0 ? (
        <ResultSection
          size="medium"
          title="점검한 기기가 없어요"
          description="이 실행 때 연결된 기기가 없었어요. 기기를 연결하고 다시 돌려 주세요."
        />
      ) : (
        <div className="results-scroll">
          <table className="results-table">
            <thead>
              <tr>
                <th scope="col">화면</th>
                {run.outcomes.map((outcome) => (
                  <th key={outcome.device.id} scope="col">
                    <VStack gap="x1" align="flex-start">
                      <Text textStyle="t3Bold">{outcome.device.model}</Text>
                      <HStack gap="x1_5" align="center">
                        <Text textStyle="t2Regular" color="fg.neutralSubtle">
                          {outcome.device.osVersion}
                        </Text>
                        <StatusBadge status={outcome.status} />
                      </HStack>
                    </VStack>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((scenario) => (
                <tr key={scenario}>
                  <th scope="row">{scenario}</th>
                  {run.outcomes.map((outcome) => (
                    <ResultCell key={outcome.device.id} outcome={outcome} scenario={scenario} onFailed={onFailed} />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {messages.length > 0 ? (
        <ul className="results-messages">
          {messages.map((outcome) => (
            <li key={outcome.device.id}>
              <Text textStyle="t3Regular" color="fg.neutralMuted">
                {outcome.device.model}: {outcome.message}
              </Text>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function StatusBadge({ status, title }: { status: CellStatus; title?: string }) {
  const look = cellBadge[status];
  return (
    <Badge tone={look.tone} variant={look.variant} title={title}>
      {cellLabel[status]}
    </Badge>
  );
}

interface ResultCellProps {
  outcome: DeviceOutcome;
  scenario: string;
  onFailed: (cell: FailedCell) => void;
}

function ResultCell({ outcome, scenario, onFailed }: ResultCellProps) {
  const screen = outcome.screens.find((item) => item.scenario === scenario);
  // 화면 결과가 없으면 기기 결과(설치 실패, 건너뜀 등)를 보인다.
  const status: CellStatus = screen ? screen.status : outcome.status;
  if (screen && screen.status === "failed") {
    return (
      <td>
        <button
          type="button"
          className="results-cell-button"
          title={screen.message}
          aria-label={`${scenario} · ${outcome.device.model} 실패 상세 보기`}
          onClick={() => onFailed({ outcome, screen })}
        >
          <StatusBadge status={status} />
        </button>
      </td>
    );
  }
  return (
    <td>
      <StatusBadge status={status} title={screen?.message} />
    </td>
  );
}

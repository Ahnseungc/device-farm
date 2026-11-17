import { useState } from "react";
import { HStack, Text, VStack } from "@seed-design/react";

import type { ChaosRunSummary } from "@device-farm/core/chaos/types";
import type { DeviceOutcome, DeviceRun, DeviceScreen, OutcomeStatus, ScreenStatus } from "@device-farm/core/device/types";
import { categoryOf, groupByVersion, runCategories, type RunCategory, type RunSummary } from "@device-farm/core/runs/summary";

import { api, usePoll } from "./api-client";
import { FailureDetail } from "./failure-detail";
import { dateLocale, plural, t } from "./i18n";
import { LoadingState } from "./loading-state";
import { MetaLine } from "./meta-line";
import { StaggeredEntrance, StaggeredEntranceItem } from "./motion/StaggeredEntrance";
import { ActionButton } from "./seed-design/ui/action-button";
import { Badge, type BadgeProps } from "./seed-design/ui/badge";
import { Callout } from "./seed-design/ui/callout";
import { ResultSection } from "./seed-design/ui/result-section";
import "./results.css";

type CellStatus = ScreenStatus | OutcomeStatus;

const cellLabel = (status: CellStatus): string =>
  ({
    passed: t("통과", "Passed"),
    failed: t("실패", "Failed"),
    candidate: t("기준 후보", "Candidate"),
    login_required: t("로그인 필요", "Login required"),
    running: t("진행 중", "Running"),
    skipped: t("건너뜀", "Skipped"),
    install_failed: t("설치 실패", "Install failed"),
    offline: t("연결 끊김", "Offline"),
  })[status];

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

const triggerLabel = (trigger: DeviceRun["trigger"]): string => (trigger === "auto" ? t("자동", "Auto") : t("수동", "Manual"));

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
  return value ? new Date(value).toLocaleString(dateLocale()) : t("진행 중", "Running");
}

/** 실행 목록은 점검이 끝날 때만 바뀐다 (작성자 판단) */
const runsPollMs = 10_000;

type CategoryFilter = RunCategory | "bot" | null;

const shortTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(dateLocale(), { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : t("진행 중", "Running");
const dayOf = (iso: string) => new Date(iso).toLocaleDateString(dateLocale(), { month: "long", day: "numeric", weekday: "short" });

/** 점검 종류 이름(core의 runCategoryLabels는 한국어만 있어 화면에서 옮긴다) */
const categoryLabel = (id: RunCategory): string =>
  ({
    flow: t("플로우 점검", "Flow check"),
    screen: t("화면 점검", "Screen check"),
    policy: t("정책 점검", "Policy check"),
    data: t("데이터 점검", "Data check"),
    layout: t("화면 깨짐 점검", "Layout check"),
  })[id];

/** 칸이 좁은 자리(행 안 종류 칩)용 짧은 이름 */
const categoryShortLabel = (id: RunCategory): string =>
  ({
    flow: t("플로우", "Flow"),
    screen: t("화면", "Screen"),
    policy: t("정책", "Policy"),
    data: t("데이터", "Data"),
    layout: t("화면 깨짐", "Layout"),
  })[id];

/** 종류 칩: 전체·플로우·화면·정책·데이터·화면 깨짐·봇 */
function CategoryChips({ value, onChange }: { value: CategoryFilter; onChange: (value: CategoryFilter) => void }) {
  const items: { id: CategoryFilter; label: string }[] = [
    { id: null, label: t("전체", "All") },
    ...runCategories.map((id) => ({ id, label: categoryLabel(id) })),
    { id: "bot", label: t("봇 점검", "Bot check") },
  ];
  return (
    <div className="runs-chips" role="group" aria-label={t("점검 종류", "Check type")}>
      {items.map((item) => (
        <button key={item.id ?? "all"} type="button" className={`runs-chip${item.id ? ` runs-cat-${item.id}` : ""}`} aria-pressed={value === item.id} onClick={() => onChange(item.id)}>
          {item.label}
        </button>
      ))}
    </div>
  );
}

/** 실행 한 줄: 시각·이름·종류별 통과 수(실패는 빨강) */
function RunRow({ run, category, onOpen }: { run: RunSummary; category: RunCategory | null; onOpen: () => void }) {
  const entries = runCategories.filter((item) => run.categories[item] && (!category || item === category));
  const kinds = runCategories.filter((item) => run.categories[item]);
  // 한 종류만 돈 실행은 그 종류 색 카드로, 여러 종류(전체 점검)는 흰 카드로
  const only = kinds.length === 1 ? kinds[0] : null;
  const name = run.label ?? (only ? categoryLabel(only) : run.trigger === "auto" ? t("자동 점검", "Auto check") : t("전체 점검", "Full check"));
  return (
    <button type="button" className={`runs-row${only ? ` runs-row-${only}` : ""}`} onClick={onOpen}>
      <Text textStyle="t3Medium" className="runs-row-time">
        {shortTime(run.startedAt)}
      </Text>
      <Text textStyle="t4Medium" className="runs-row-name">
        <MetaLine items={[name, run.finishedAt === null ? t("진행 중", "Running") : null]} />
      </Text>
      <span className="runs-row-counts">
        {entries.map((item) => {
          const count = run.categories[item]!;
          return (
            <span key={item} className={`runs-cat runs-cat-${item}`}>
              <span className="runs-cat-name">{categoryShortLabel(item)}</span>
              <span className="runs-cat-count">{`${count.total - count.failed}/${count.total}`}</span>
              {count.failed > 0 ? <span className="runs-cat-failed">{t(`실패 ${count.failed}`, `${count.failed} failed`)}</span> : null}
            </span>
          );
        })}
      </span>
    </button>
  );
}

/** 버전 묶음. 가장 최근 버전만 펼쳐 둔다 */
function VersionGroups({ runs, category, onOpen }: { runs: RunSummary[]; category: RunCategory | null; onOpen: (runId: string) => void }) {
  const groups = groupByVersion(runs, category);
  if (groups.length === 0) return <ResultSection size="medium" title={t("이 종류의 점검 기록이 없어요", "No checks of this type yet")} description={t("점검을 돌리면 버전별로 여기에 쌓여요.", "Runs pile up here by version.")} />;
  return (
    <StaggeredEntrance className="runs-groups">
      {groups.map((group, index) => (
        <StaggeredEntranceItem key={group.key}>
          <details className="runs-group" open={index === 0}>
            <summary className="runs-group-head">
              <Text textStyle="t5Bold">{group.key}</Text>
              <Text textStyle="t3Regular" color="fg.neutralMuted">
                <MetaLine items={[t(`점검 ${group.runs.length}번`, plural(group.runs.length, "run")), t(`마지막 ${shortTime(group.lastAt)}`, `Last ${shortTime(group.lastAt)}`)]} />
              </Text>
              {group.failed > 0 ? (
                <Badge tone="critical" variant="weak">
                  {t(`실패 ${group.failed}`, `${group.failed} failed`)}
                </Badge>
              ) : (
                <Badge tone="positive" variant="weak">
                  {t("모두 통과", "All passed")}
                </Badge>
              )}
            </summary>
            <div className="runs-rows">
              {group.runs.map((run) => (
                <RunRow key={run.runId} run={run} category={category} onOpen={() => onOpen(run.runId)} />
              ))}
            </div>
          </details>
        </StaggeredEntranceItem>
      ))}
    </StaggeredEntrance>
  );
}

/** 봇 점검은 앱 버전을 따로 남기지 않아 날짜로 묶는다 */
function BotGroups({ onOpenBot }: { onOpenBot: () => void }) {
  const bots = usePoll(api.chaosRuns, runsPollMs);
  if (bots.data === undefined) return <LoadingState />;
  const byDay = new Map<string, ChaosRunSummary[]>();
  for (const run of bots.data) byDay.set(dayOf(run.startedAt), [...(byDay.get(dayOf(run.startedAt)) ?? []), run]);
  if (byDay.size === 0) return <ResultSection size="medium" title={t("봇 점검 기록이 없어요", "No bot checks yet")} description={t("오늘 화면이나 밤 03:30 자동 점검으로 돌아요.", "Run one from Today, or wait for the 03:30 nightly run.")} />;
  return (
    <VStack gap="x3">
      {[...byDay].map(([day, runs], index) => (
        <details key={day} className="runs-group" open={index === 0}>
          <summary className="runs-group-head">
            <Text textStyle="t5Bold">{day}</Text>
            <Text textStyle="t3Regular" color="fg.neutralMuted">{t(`봇 점검 ${runs.length}번`, plural(runs.length, "bot run"))}</Text>
          </summary>
          <div className="runs-rows">
            {runs.map((run) => (
              <button key={run.runId} type="button" className="runs-row runs-row-bot" onClick={onOpenBot}>
                <Text textStyle="t3Medium" className="runs-row-time">
                  {shortTime(run.startedAt)}
                </Text>
                <Text textStyle="t4Medium" className="runs-row-name"><MetaLine items={[t(`시드 ${run.seed}`, `Seed ${run.seed}`), t(`${run.steps}스텝`, plural(run.steps, "step")), t(`화면 ${run.states}개`, plural(run.states, "screen"))]} /></Text>
                <span className="runs-row-counts">
                  <span className="runs-cat runs-cat-bot">
                    <span className="runs-cat-name">{t("봇", "Bot")}</span>
                    <span className="runs-cat-count">{t(`${run.steps}스텝`, plural(run.steps, "step"))}</span>
                    {run.errorSteps > 0 ? <span className="runs-cat-failed">{t(`오류 ${run.errorSteps}`, `${run.errorSteps} errors`)}</span> : null}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </details>
      ))}
    </VStack>
  );
}

/** 실행 하나 상세: 종류를 골랐으면 그 종류 화면만 */
function RunDetail({ runId, category, onBack }: { runId: string; category: RunCategory | null; onBack: () => void }) {
  const run = usePoll(() => api.run(runId), runsPollMs);
  const [failed, setFailed] = useState<FailedCell | null>(null);
  return (
    <VStack gap="x3">
      <div>
        <ActionButton variant="ghost" size="small" onClick={onBack}>
          {t("점검 기록으로", "Back to history")}
        </ActionButton>
      </div>
      {run.error ? <Callout tone="critical" description={run.error} /> : null}
      {run.data ? <RunTable run={run.data} category={category} onFailed={setFailed} /> : run.error ? null : <LoadingState />}
      {failed ? <FailureDetail cell={failed} onClose={() => setFailed(null)} /> : null}
    </VStack>
  );
}

/** 「점검 기록」: 종류로 거르고, 앱 버전별로 접고, 실행마다 날짜와 종류별 통과 수 */
export function ResultsScreen({ onOpenBot }: { onOpenBot: () => void }) {
  const runs = usePoll(api.runs, runsPollMs);
  const [category, setCategory] = useState<CategoryFilter>(null);
  const [openRunId, setOpenRunId] = useState<string | null>(null);
  const deviceCategory = category === "bot" ? null : category;

  if (openRunId) return <RunDetail runId={openRunId} category={deviceCategory} onBack={() => setOpenRunId(null)} />;
  return (
    <VStack gap="x4" className="results-page">
      <HStack gap="x3" align="center" justify="space-between" wrap="wrap">
        <Text as="h1" textStyle="t6Bold">
          {t("점검 기록", "Check history")}
        </Text>
        <CategoryChips value={category} onChange={setCategory} />
      </HStack>
      {runs.error ? <Callout tone="critical" description={runs.error} /> : null}
      {category === "bot" ? (
        <BotGroups onOpenBot={onOpenBot} />
      ) : runs.data === undefined ? (
        runs.error ? null : <LoadingState />
      ) : (
        <VersionGroups runs={runs.data} category={deviceCategory} onOpen={setOpenRunId} />
      )}
    </VStack>
  );
}

interface RunTableProps {
  run: DeviceRun;
  /** 고른 점검 종류의 화면만 */
  category?: RunCategory | null;
  onFailed: (cell: FailedCell) => void;
}

function RunTable({ run, category = null, onFailed }: RunTableProps) {
  const rows = scenarioRows(run).filter((scenario) => !category || categoryOf(scenario) === category);
  const messages = run.outcomes.filter((outcome) => outcome.message);
  return (
    <section className="results-card" aria-label={t("최근 점검 결과", "Latest check results")}>
      <div className="results-head">
        <HStack gap="x2" align="center" wrap="wrap">
          <Text as="h2" textStyle="t5Bold">
            {run.label ?? `${run.kind} ${run.version}`}
          </Text>
          <Badge tone={triggerTone[run.trigger]} variant="weak">
            {triggerLabel(run.trigger)}
          </Badge>
        </HStack>
        <Text as="p" textStyle="t3Regular" color="fg.neutralSubtle">
          {formatTime(run.startedAt)} ~ {formatTime(run.finishedAt)}
        </Text>
      </div>
      {run.outcomes.length === 0 ? (
        <ResultSection
          size="medium"
          title={t("점검한 기기가 없어요", "No devices were checked")}
          description={t("이 실행 때 연결된 기기가 없었어요. 기기를 연결하고 다시 돌려 주세요.", "No devices were connected during this run. Connect a device and run it again.")}
        />
      ) : (
        <div className="results-scroll">
          <table className="results-table">
            <thead>
              <tr>
                <th scope="col">{t("화면", "Screen")}</th>
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
      {cellLabel(status)}
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
          aria-label={t(`${scenario}(${outcome.device.model}) 실패 상세 보기`, `View failure details for ${scenario} (${outcome.device.model})`)}
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

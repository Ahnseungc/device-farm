import type { ChaosRunSummary } from "@device-farm/core/chaos/types";
import type { DeviceRun } from "@device-farm/core/device/types";
import type { ExploreRun } from "@device-farm/core/explore/actions";
import type { PolicyWatchState } from "@device-farm/core/policy/snapshot";

import { plural, t } from "./i18n";

/** 진행 중 플로팅·완료 알림이 보여 줄 내용. 화면 코드 없이 테스트한다 */

/** 작업을 누르면 여는 탭 */
export type ActivityTab = "results" | "policy" | "chaos" | "explore";

/** 「중지」로 멈출 작업 종류(서버 POST /api/devices/jobs/stop의 kind) */
export type StopKind = "run" | "bot" | "explore" | "policy";

/** 지금 도는 작업 하나 */
export interface Activity {
  /** 같은 작업이면 같은 id. 사라지면 끝난 것으로 보고 알림을 띄운다 */
  id: string;
  title: string;
  detail: string;
  tab: ActivityTab;
  /** 0~1. 모르면 없음 */
  ratio?: number;
  /** 플로팅 「중지」 버튼이 멈출 종류 */
  stop: StopKind;
}

export interface DoneToast {
  key: number;
  title: string;
  detail: string;
  tone: "positive" | "critical" | "neutral";
  tab: ActivityTab;
}

/** 완료 알림이 떠 있는 시간 (작성자 판단) */
export const toastVisibleMs = 4_500;
/** 사라지는 애니메이션 시간. activity-dock.css 의 toast-out 과 같다 */
export const toastLeaveMs = 250;
/**
 * 이보다 오래된 「끝나지 않은」 봇 점검·탐색은 중간에 멈춘 기록으로 본다. 봇 점검은 기본 60분에 끝난다 (작성자 판단).
 * 프로세스를 강제로 끝내면 finishedAt 없이 남아 계속 진행 중으로 보였다(2026-11-12).
 */
const staleRunMs = 2 * 60 * 60_000;
const isLive = (run: { finishedAt: string | null; startedAt: string }) => run.finishedAt === null && Date.now() - Date.parse(run.startedAt) < staleRunMs;

export function runActivity(run: DeviceRun | null | undefined): Activity | null {
  if (!run || !isLive(run)) return null;
  const outcome = run.outcomes.find((item) => item.status === "running") ?? run.outcomes[0];
  const done = run.outcomes.reduce((sum, item) => sum + item.screens.length, 0);
  const total = (run.scenarioCount ?? 0) * run.outcomes.length;
  return {
    id: `run:${run.runId}`,
    title: run.label ?? (run.trigger === "auto" ? `${t("자동 점검", "Auto check")} · ${run.kind} ${run.version}` : t("점검", "Check")),
    detail: outcome?.current ?? (outcome?.phase === "installing" ? t("설치 중", "Installing") : t("준비 중", "Preparing")),
    tab: "results",
    ratio: total > 0 ? Math.min(done / total, 1) : undefined,
    stop: "run",
  };
}

export function policyActivity(policy: PolicyWatchState | null | undefined): Activity | null {
  if (!policy?.running) return null;
  const progress = policy.progress;
  return {
    id: "policy",
    title: progress ? t("정책 규칙 뽑기", "Extracting policy rules") : t("정책 바뀜 확인", "Checking policy changes"),
    detail: progress ? `${progress.done + 1} / ${progress.total} ${t("정책", "policies")}` : t("Confluence 정책 읽는 중", "Reading Confluence policies"),
    tab: "policy",
    ratio: progress && progress.total > 0 ? progress.done / progress.total : undefined,
    stop: "policy",
  };
}

export const botActivities = (runs: ChaosRunSummary[] | undefined): Activity[] =>
  (runs ?? [])
    .filter(isLive)
    .map((run): Activity => ({ id: `bot:${run.runId}`, title: `${t("봇 점검", "Bot check")} · ${t("시드", "seed")} ${run.seed}`, detail: run.steps === 0 ? `${run.deviceId} ${t("준비 중", "preparing")}` : `${run.deviceId} · ${t(`${run.steps}스텝`, plural(run.steps, "step"))} · ${t("오류 스텝", "error steps")} ${run.errorSteps}`, tab: "chaos", stop: "bot" }));

export const exploreActivities = (runs: ExploreRun[] | undefined): Activity[] =>
  (runs ?? [])
    .filter(isLive)
    .map((run): Activity => ({ id: `explore:${run.runId}`, title: t("탐색", "Explore"), detail: t(`경로 ${run.paths.length}개 · 이상 ${run.issues.length}개`, `${plural(run.paths.length, "path")} · ${plural(run.issues.length, "issue")}`), tab: "explore", stop: "explore" }));

/** 끝난 작업의 결과 한 줄. 폴링 값이 끝난 상태로 바뀐 뒤에 부른다 */
export function finishedToast(id: string, sources: { run?: DeviceRun | null; policy?: PolicyWatchState | null; bots?: ChaosRunSummary[]; explores?: ExploreRun[] }): Omit<DoneToast, "key"> {
  if (id.startsWith("run:") && sources.run) {
    const screens = sources.run.outcomes.flatMap((outcome) => outcome.screens);
    const failed = screens.filter((screen) => screen.status === "failed").length;
    return {
      title: failed > 0 ? t("점검 끝 · 실패 있음", "Check done · failures") : t("점검 끝 · 모두 통과", "Check done · all passed"),
      detail: t(`${screens.length}개 중 통과 ${screens.length - failed} · 실패 ${failed}`, `${screens.length - failed} of ${screens.length} passed · ${failed} failed`),
      tone: failed > 0 ? "critical" : "positive",
      tab: "results",
    };
  }
  if (id === "policy" && sources.policy) {
    const rules = sources.policy.rules.reduce((sum, page) => sum + page.rules.length, 0);
    const failed = sources.policy.extractFailed.length;
    return {
      title: failed > 0 ? t("정책 확인 끝 · 일부 실패", "Policy check done · some failed") : t("정책 확인 끝", "Policy check done"),
      detail: t(
        `정책 ${sources.policy.rules.length}개 · 규칙 ${rules}개${failed > 0 ? ` · 못 뽑은 정책 ${failed}개` : ""}`,
        `${plural(sources.policy.rules.length, "policy", "policies")} · ${plural(rules, "rule")}${failed > 0 ? ` · ${failed} not extracted` : ""}`,
      ),
      tone: failed > 0 || sources.policy.lastError ? "critical" : "positive",
      tab: "policy",
    };
  }
  if (id.startsWith("bot:")) {
    const run = sources.bots?.find((item) => `bot:${item.runId}` === id);
    return {
      title: run && run.errorSteps > 0 ? t("봇 점검 끝 · 오류 있음", "Bot check done · errors") : t("봇 점검 끝", "Bot check done"),
      detail: run
        ? t(`${run.steps}스텝 · 상태 ${run.states}개 · 오류 스텝 ${run.errorSteps}`, `${plural(run.steps, "step")} · ${plural(run.states, "state")} · ${run.errorSteps} error steps`)
        : t("결과를 봇 점검 탭에서 확인하세요", "See the results in the Bot check tab"),
      tone: run && run.errorSteps > 0 ? "critical" : "positive",
      tab: "chaos",
    };
  }
  const explore = sources.explores?.find((item) => `explore:${item.runId}` === id);
  return {
    title: t("탐색 끝", "Explore done"),
    detail: explore
      ? t(`경로 ${explore.paths.length}개 · 이상 ${explore.issues.length}개`, `${plural(explore.paths.length, "path")} · ${plural(explore.issues.length, "issue")}`)
      : t("결과를 탐색 탭에서 확인하세요", "See the results in the Explore tab"),
    tone: explore && explore.issues.length > 0 ? "critical" : "positive",
    tab: "explore",
  };
}

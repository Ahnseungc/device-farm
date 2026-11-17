/**
 * 「점검 기록」 요약: 실행마다 점검 종류(카테고리)별 통과·실패 수, 앱 버전별 묶음. 화면 코드 없이 테스트한다.
 */

export const runCategories = ["flow", "screen", "policy", "data", "layout"] as const;
export type RunCategory = (typeof runCategories)[number];

export const runCategoryLabels: Record<RunCategory, string> = {
  flow: "플로우 점검",
  screen: "화면 점검",
  policy: "정책 점검",
  data: "데이터 점검",
  layout: "화면 깨짐 점검",
};

/** 결과 목록 앞머리 → 종류. 앞머리가 없으면 시나리오 화면 점검 */
const prefixes: readonly [string, RunCategory][] = [
  ["플로우 점검 · ", "flow"],
  ["플로우 · ", "flow"],
  ["정책 점검 · ", "policy"],
  ["정책 · ", "policy"],
  ["데이터 점검 · ", "data"],
  ["화면 깨짐 점검 · ", "layout"],
  // 2026-11-16 이전 이름. farm.db 예전 기록
  ["배치 점검 · ", "layout"],
];

export function categoryOf(scenario: string): RunCategory {
  return prefixes.find(([prefix]) => scenario.startsWith(prefix))?.[1] ?? "screen";
}

export interface CategoryCount {
  total: number;
  failed: number;
}

export interface RunSummary {
  runId: string;
  label?: string;
  kind: string;
  /** 요청한 버전(「설치된 앱」일 수 있다) */
  version: string;
  /** 기기에 깔린 앱 버전(있으면). 묶음 기준 */
  appVersion: string | null;
  trigger: string;
  startedAt: string;
  finishedAt: string | null;
  categories: Partial<Record<RunCategory, CategoryCount>>;
}

/** 화면 행 → 종류별 수 */
export function countCategories(screens: readonly { scenario: string; status: string }[]): Partial<Record<RunCategory, CategoryCount>> {
  const counts: Partial<Record<RunCategory, CategoryCount>> = {};
  for (const screen of screens) {
    const category = categoryOf(screen.scenario);
    const count = (counts[category] ??= { total: 0, failed: 0 });
    count.total += 1;
    if (screen.status === "failed") count.failed += 1;
  }
  return counts;
}

/** 묶음 이름: `dev 2.0.28+463`. 깔린 버전을 모르면 요청 버전 */
export const versionKey = (run: RunSummary) => `${run.kind} ${run.appVersion ?? run.version}`;

export interface VersionGroup {
  key: string;
  runs: RunSummary[];
  lastAt: string;
  failed: number;
}

/** 버전별로 묶는다. 최근에 점검한 버전 먼저, 묶음 안은 최근 실행 먼저. category를 주면 그 종류가 있는 실행만 */
export function groupByVersion(runs: readonly RunSummary[], category: RunCategory | null = null): VersionGroup[] {
  const groups = new Map<string, RunSummary[]>();
  for (const run of runs) {
    if (category && !run.categories[category]) continue;
    groups.set(versionKey(run), [...(groups.get(versionKey(run)) ?? []), run]);
  }
  return [...groups]
    .map(([key, items]) => {
      const sorted = [...items].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
      const failed = sorted.reduce((sum, run) => sum + Object.entries(run.categories).reduce((inner, [name, count]) => inner + (!category || name === category ? (count?.failed ?? 0) : 0), 0), 0);
      return { key, runs: sorted, lastAt: sorted[0].startedAt, failed };
    })
    .sort((a, b) => b.lastAt.localeCompare(a.lastAt));
}

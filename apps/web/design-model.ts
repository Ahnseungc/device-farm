import { minFigmaCoverage } from "@device-farm/core/policy/compare";
import type { DesignPage } from "@device-farm/core/policy/design-page";

import { dateLocale, t } from "./i18n";

export type DesignSort = "path" | "match" | "mismatch";

export const designSorts = (): { value: DesignSort; label: string }[] => [
  { value: "path", label: t("경로순", "By path") },
  { value: "match", label: t("일치율 낮은순", "Lowest match first") },
  { value: "mismatch", label: t("어긋남 많은순", "Most mismatches first") },
];

/** 일치율 0~1 → 「82%」. 없으면 「—」 */
export function percent(value: number | undefined): string {
  return value === undefined ? "—" : `${Math.round(value * 100)}%`;
}

/**
 * 일치율 색: 70% 이상 좋음 (작성자 판단), 30% 이상 보통.
 * 30%(minFigmaCoverage) 미만은 점검기가 「연결된 피그마가 이 화면 디자인이 아니다」로 보고 대조에서 빼는 화면이라
 * 낮은 일치율이 아니라 「피그마 확인 필요」다. 정책 문서 하나의 작은 피그마 프레임이 화면 18개에 걸려 0%가 줄줄이 나왔다(2026-11-17).
 */
export function matchTone(value: number | undefined): "good" | "fair" | "suspect" | "none" {
  if (value === undefined) return "none";
  if (value >= 0.7) return "good";
  if (value >= minFigmaCoverage) return "fair";
  return "suspect";
}

/** 일치율로 셀 수 있는 값(피그마 확인 필요가 아닌 것) */
const countable = (value: number | undefined): value is number => value !== undefined && value >= minFigmaCoverage;

export interface DesignSummary {
  total: number;
  checked: number;
  /** 일치율을 잰 화면들의 평균(피그마 확인 필요는 뺀다). 잰 화면이 없으면 없다 */
  averageMatch?: number;
  withMismatch: number;
  /** 연결된 피그마가 이 화면 디자인이 아닌 것 같은 화면 수 */
  figmaSuspect: number;
}

export function summarize(pages: readonly DesignPage[]): DesignSummary {
  const checked = pages.filter((page) => page.last);
  const coverages = checked.map((page) => page.last?.figmaCoverage);
  const measured = coverages.filter(countable);
  return {
    total: pages.length,
    checked: checked.length,
    ...(measured.length > 0 ? { averageMatch: measured.reduce((sum, value) => sum + value, 0) / measured.length } : {}),
    withMismatch: checked.filter((page) => (page.last?.mismatches ?? 0) > 0).length,
    figmaSuspect: coverages.filter((value) => matchTone(value) === "suspect").length,
  };
}

/** 찾기(경로 일부)와 정렬. 일치율 정렬에서 피그마 확인 필요는 잰 화면 뒤, 아직 안 잰 화면은 맨 뒤 */
export function visiblePages(pages: readonly DesignPage[], query: string, sort: DesignSort): DesignPage[] {
  const needle = query.trim().toLowerCase();
  const found = needle ? pages.filter((page) => page.path.toLowerCase().includes(needle)) : [...pages];
  const byPath = (a: DesignPage, b: DesignPage) => a.path.localeCompare(b.path);
  if (sort === "match") {
    const key = (page: DesignPage) => {
      const value = page.last?.figmaCoverage;
      if (countable(value)) return value;
      return value === undefined ? 3 : 2;
    };
    return found.sort((a, b) => key(a) - key(b) || byPath(a, b));
  }
  if (sort === "mismatch") {
    const key = (page: DesignPage) => (page.last ? page.last.mismatches : -1);
    return found.sort((a, b) => key(b) - key(a) || byPath(a, b));
  }
  return found.sort(byPath);
}

/** 마지막 점검 시각 「11. 17. 오후 2:05」 */
export function checkedAt(iso: string): string {
  return new Date(iso).toLocaleString(dateLocale(), { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" });
}

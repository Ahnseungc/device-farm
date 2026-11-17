import { useState } from "react";
import { HStack, Text, VStack } from "@seed-design/react";

import type { DesignPage } from "@device-farm/core/policy/design-page";

import { api, errorMessage, usePoll } from "./api-client";
import { checkedAt, designSorts, matchTone, percent, summarize, visiblePages, type DesignSort } from "./design-model";
import { FloatingNotice } from "./floating-notice";
import { t } from "./i18n";
import { LoadingState } from "./loading-state";
import { MetaLine } from "./meta-line";
import { ActionButton } from "./seed-design/ui/action-button";
import { Badge } from "./seed-design/ui/badge";
import { Callout } from "./seed-design/ui/callout";
import { ResultSection } from "./seed-design/ui/result-section";
import { SegmentedControl, SegmentedControlItem } from "./seed-design/ui/segmented-control";
import { TextField, TextFieldInput } from "./seed-design/ui/text-field";
import "./design.css";

function MatchBar({ value }: { value: number | undefined }) {
  const tone = matchTone(value);
  if (tone === "suspect") {
    return (
      <div className="design-match" data-tone={tone} title={t(
          `일치율 ${percent(value)}: 연결된 피그마가 이 화면 디자인이 아닌 것 같아 대조에서 뺐어요. 정책 문서·프론트 코드의 피그마 링크를 확인해 주세요.`,
          `Match ${percent(value)}: the linked Figma doesn't look like this screen's design, so it was left out of the comparison. Check the Figma link in the policy doc or frontend code.`,
        )}>
        <Badge tone="neutral" variant="weak">
          {t("피그마 확인 필요", "Check Figma link")}
        </Badge>
      </div>
    );
  }
  return (
    <div className="design-match" data-tone={tone} title={t("일치율: 화면 문구 중 피그마에도 있는 비율", "Match: share of on-screen text that also appears in Figma")}>
      <div className="design-match-track" aria-hidden="true">
        <div className="design-match-fill" style={{ width: `${Math.round((value ?? 0) * 100)}%` }} />
      </div>
      <Text textStyle="t4Bold" className="design-match-value">
        {percent(value)}
      </Text>
    </div>
  );
}

function PageRow({ page, chosen, running, onToggle, onCheck }: { page: DesignPage; chosen: boolean; running: boolean; onToggle: () => void; onCheck: () => void }) {
  const { last } = page;
  return (
    <div className="design-row">
      <input type="checkbox" className="design-pick" checked={chosen} onChange={onToggle} aria-label={t(`${page.path} 고르기`, `Select ${page.path}`)} />
      <VStack gap="x1" className="design-row-body">
        <Text textStyle="t5Bold" className="design-path">
          {page.path}
        </Text>
        <Text textStyle="t3Regular" color="fg.neutralMuted">
          <MetaLine
            items={[
              page.hasFigma ? t("피그마 연결", "Figma linked") : t("피그마 없음", "No Figma"),
              page.rules > 0 ? t(`정책 규칙 ${page.rules}개`, `${page.rules} policy rule(s)`) : null,
              last ? t(`${checkedAt(last.at)} 점검`, `Checked ${checkedAt(last.at)}`) : t("아직 점검 안 함", "Not checked yet"),
            ]}
          />
        </Text>
        {last?.message ? (
          <Text textStyle="t3Regular" color="fg.neutralMuted" className="design-row-message">
            {last.message}
          </Text>
        ) : null}
      </VStack>
      <HStack gap="x3" align="center" className="design-row-side">
        {last && last.mismatches > 0 ? (
          <Badge tone="warning" variant="weak">
            {t(`어긋남 ${last.mismatches}`, `Mismatches ${last.mismatches}`)}
          </Badge>
        ) : last ? (
          <Badge tone="positive" variant="weak">
            {t("맞음", "Matches")}
          </Badge>
        ) : null}
        <MatchBar value={page.hasFigma ? last?.figmaCoverage : undefined} />
        <ActionButton variant="neutralWeak" size="small" disabled={running} onClick={onCheck}>
          {t("점검", "Check")}
        </ActionButton>
      </HStack>
    </div>
  );
}

/** 「디자인 점검」: 피그마·정책이 연결된 화면 전부, 일치율, 화면별·전체 점검 */
export function DesignScreen() {
  const state = usePoll(api.designPages);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<DesignSort>("path");
  const [chosen, setChosen] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  async function check(paths?: string[]) {
    setRunning(true);
    try {
      await api.startRun({ kind: "dev", devices: "all", designOnly: true, ...(paths ? { designPaths: paths } : {}) });
      const what = paths ? (paths.length === 1 ? paths[0] : t(`화면 ${paths.length}개`, `${paths.length} screens`)) : t("전체 화면", "all screens");
      setMessage({
        text: t(
          `${what} 디자인 점검을 시작했어요. 지금 깔린 dev 앱으로 보고, 오른쪽에서 진행을 볼 수 있어요.`,
          `Started the design check for ${what}. It uses the dev app installed now; progress shows on the right.`,
        ),
        error: false,
      });
      if (paths) setChosen((current) => current.filter((path) => !paths.includes(path)));
    } catch (error) {
      setMessage({ text: errorMessage(error), error: true });
    } finally {
      setRunning(false);
    }
  }

  if (state.data === undefined) return state.error ? <Callout tone="critical" description={state.error} /> : <LoadingState />;
  const pages = state.data;
  const summary = summarize(pages);
  const shown = visiblePages(pages, query, sort);
  const picked = chosen.filter((path) => pages.some((page) => page.path === path));
  const toggle = (path: string) => setChosen((current) => (current.includes(path) ? current.filter((item) => item !== path) : [...current, path]));

  return (
    <VStack gap="x5" className="design-page">
      <FloatingNotice notice={message} onClose={() => setMessage(null)} />
      <HStack justify="space-between" align="flex-end" gap="x3" wrap="wrap">
        <VStack gap="x1">
          <Text as="h1" textStyle="t7Bold">
            {t(`디자인 점검 · 화면 ${summary.total}개`, `Design check · ${summary.total} screens`)}
          </Text>
          <Text textStyle="t4Regular" color="fg.neutralMuted">
            {t(
              "피그마·정책이 연결된 화면을 열어 문구가 피그마와 얼마나 맞는지 봐요. 설치 없이 지금 깔린 dev 앱으로 점검해요.",
              "Opens screens linked to Figma or policy docs and measures how well their text matches Figma. Uses the dev app already installed, no new install.",
            )}
          </Text>
        </VStack>
        <ActionButton variant="brandSolid" size="medium" loading={running} disabled={running || pages.length === 0} onClick={() => void check()}>
          {t("전부 점검", "Check all")}
        </ActionButton>
      </HStack>

      {state.error ? <Callout tone="critical" description={state.error} /> : null}

      {pages.length === 0 ? (
        <div className="design-card">
          <ResultSection
            size="medium"
            title={t("점검할 디자인 화면이 없어요", "No design screens to check")}
            description={t(
              "정책 규칙을 뽑거나 프론트 코드에 피그마 링크가 달린 화면을 한 번 점검하면 여기에 나와요.",
              "Screens show up here once you extract policy rules or check a screen with a Figma link in the frontend code.",
            )}
          />
        </div>
      ) : (
        <>
          <div className="design-summary">
            <div className="design-stat">
              <Text textStyle="t3Regular" color="fg.neutralMuted">
                {t("평균 일치율", "Average match")}
              </Text>
              <Text textStyle="t7Bold">{percent(summary.averageMatch)}</Text>
            </div>
            <div className="design-stat">
              <Text textStyle="t3Regular" color="fg.neutralMuted">
                {t("점검한 화면", "Checked screens")}
              </Text>
              <Text textStyle="t7Bold">{`${summary.checked} / ${summary.total}`}</Text>
            </div>
            <div className="design-stat">
              <Text textStyle="t3Regular" color="fg.neutralMuted">
                {t("어긋남 있는 화면", "Screens with mismatches")}
              </Text>
              <Text textStyle="t7Bold">{summary.withMismatch}</Text>
            </div>
            <div className="design-stat" title={t("일치율 30% 미만: 연결된 피그마가 이 화면 디자인이 아닌 것 같아 평균과 대조에서 뺐어요", "Under 30% match: the linked Figma doesn't look like this screen's design, so it's left out of the average and comparison")}>
              <Text textStyle="t3Regular" color="fg.neutralMuted">
                {t("피그마 확인 필요", "Check Figma link")}
              </Text>
              <Text textStyle="t7Bold">{summary.figmaSuspect}</Text>
            </div>
          </div>

          <HStack gap="x3" align="flex-end" wrap="wrap" justify="space-between">
            <div className="design-search">
              <TextField label={t("찾기", "Search")} value={query} onValueChange={({ value }) => setQuery(value)}>
                <TextFieldInput placeholder={t("경로로 찾기 (예: settings)", "Search by path (e.g. settings)")} />
              </TextField>
            </div>
            <SegmentedControl aria-label={t("정렬", "Sort")} value={sort} onValueChange={(value) => setSort((designSorts().find((item) => item.value === value)?.value ?? "path") as DesignSort)}>
              {designSorts().map((item) => (
                <SegmentedControlItem key={item.value} value={item.value}>
                  {item.label}
                </SegmentedControlItem>
              ))}
            </SegmentedControl>
          </HStack>

          <div className="design-list" role="list" aria-label={t("디자인 화면", "Design screens")}>
            {shown.map((page) => (
              <div role="listitem" key={page.path}>
                <PageRow page={page} chosen={picked.includes(page.path)} running={running} onToggle={() => toggle(page.path)} onCheck={() => void check([page.path])} />
              </div>
            ))}
          </div>
          {shown.length === 0 ? (
            <Text textStyle="t4Regular" color="fg.neutralMuted">
              {t(`「${query.trim()}」에 맞는 화면이 없어요.`, `No screens match “${query.trim()}”.`)}
            </Text>
          ) : null}
        </>
      )}

      {picked.length > 0 ? (
        <div className="design-bar" role="region" aria-label={t("고른 화면", "Selected screens")}>
          <Text textStyle="t4Bold">{t(`${picked.length}개 골랐어요`, `${picked.length} selected`)}</Text>
          <HStack gap="x2">
            <ActionButton variant="ghost" size="medium" onClick={() => setChosen([])}>
              {t("고르기 취소", "Clear selection")}
            </ActionButton>
            <ActionButton variant="brandSolid" size="medium" loading={running} disabled={running} onClick={() => void check(picked)}>
              {t("고른 화면 점검", "Check selected")}
            </ActionButton>
          </HStack>
        </div>
      ) : null}
    </VStack>
  );
}

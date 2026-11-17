import { useMemo, useState } from "react";
import { HStack, Text, VStack } from "@seed-design/react";

import { issueKinds, openCounts, type FarmIssue, type IssueKind } from "@device-farm/core/issues/issue";
import type { AlertStatus } from "@device-farm/core/slack/policy-alert";

import { api, errorMessage, resultFileUrl, usePoll, type IssueStatusChange } from "./api-client";
import { dateLocale, plural, t } from "./i18n";
import { alertStatusLabel, issueKindHint, issueKindLabel } from "./issue-labels";
import { LoadingState } from "./loading-state";
import { MetaLine } from "./meta-line";
import { ActionButton } from "./seed-design/ui/action-button";
import { Badge, type BadgeProps } from "./seed-design/ui/badge";
import { Callout } from "./seed-design/ui/callout";
import { SegmentedControl, SegmentedControlItem } from "./seed-design/ui/segmented-control";
import "./issues.css";

/** 문제 목록은 알림이 쌓일 때만 바뀐다 (작성자 판단) */
const issuesPollMs = 10_000;

const kindTone: Record<IssueKind, BadgeProps["tone"]> = {
  "app-error": "critical",
  behavior: "warning",
  policy: "critical",
  design: "informative",
  docs: "neutral",
  unverified: "warning",
};

const statusTone: Record<AlertStatus, BadgeProps["tone"]> = { open: "critical", checking: "warning", done: "positive", "not-issue": "neutral" };

const statusFilterIds = ["open", "all", "closed"] as const;
type StatusFilter = (typeof statusFilterIds)[number];
const statusFilterLabel = (id: StatusFilter): string => ({ open: t("남은 것", "Open"), all: t("전체", "All"), closed: t("끝난 것", "Closed") })[id];

const isOpen = (issue: FarmIssue) => issue.status === "open" || issue.status === "checking";

function matches(issue: FarmIssue, kind: IssueKind | null, status: StatusFilter): boolean {
  if (kind && issue.kind !== kind) return false;
  if (status === "open") return isOpen(issue);
  if (status === "closed") return !isOpen(issue);
  return true;
}

const shortTime = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString(dateLocale(), { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
};

/** 유형 칩: 누르면 그 유형만, 다시 누르면 전체 */
function KindFilter({ issues, kind, onChange }: { issues: FarmIssue[]; kind: IssueKind | null; onChange: (kind: IssueKind | null) => void }) {
  const counts = openCounts(issues);
  return (
    <div className="issues-kinds" role="group" aria-label={t("문제 유형", "Problem types")}>
      {issueKinds.map((item) => (
        <button key={item} type="button" className="issues-kind" aria-pressed={kind === item} title={issueKindHint(item)} onClick={() => onChange(kind === item ? null : item)}>
          <Text textStyle="t3Medium" color="fg.neutralMuted">
            {issueKindLabel(item)}
          </Text>
          <Text textStyle="t5Bold" color={counts[item] > 0 ? "fg.neutral" : "fg.neutralSubtle"}>
            {counts[item]}
          </Text>
        </button>
      ))}
    </div>
  );
}

function IssueRow({ issue, selected, onSelect }: { issue: FarmIssue; selected: boolean; onSelect: () => void }) {
  return (
    <button type="button" className="issues-row" aria-current={selected ? "true" : undefined} onClick={onSelect}>
      <HStack gap="x1_5" align="center" wrap="wrap">
        <Badge tone={kindTone[issue.kind]} variant="weak">
          {issueKindLabel(issue.kind)}
        </Badge>
        {issue.status !== "open" ? (
          <Badge tone={statusTone[issue.status]} variant="outline">
            {alertStatusLabel(issue.status)}
          </Badge>
        ) : null}
        <Text textStyle="t2Regular" color="fg.neutralSubtle">
          {shortTime(issue.sentAt)}
        </Text>
      </HStack>
      <Text textStyle="t4Medium" className="issues-row-title">
        {issue.title}
      </Text>
      <Text textStyle="t3Regular" color="fg.neutralMuted" className="issues-row-path">
        {issue.path}
      </Text>
    </button>
  );
}

/** 오른쪽 상세: 무엇이 다른지·화면·링크·처리 버튼 */
function IssueDetail({ issue, onChanged }: { issue: FarmIssue; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState<IssueStatusChange | null>(null);
  const [error, setError] = useState<string | null>(null);
  const change = async (status: IssueStatusChange) => {
    setBusy(status);
    setError(null);
    try {
      await api.setIssueStatus(issue.key, status);
      await onChanged();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(null);
    }
  };
  return (
    <section className="issues-detail" aria-label={t("문제 상세", "Problem details")}>
      <VStack gap="x1">
        <HStack gap="x1_5" align="center" wrap="wrap">
          <Badge tone={kindTone[issue.kind]} variant="weak">
            {issueKindLabel(issue.kind)}
          </Badge>
          <Text textStyle="t3Regular" color="fg.neutralSubtle">
            {issue.label}
          </Text>
        </HStack>
        <Text as="h2" textStyle="t6Bold">
          {issue.title}
        </Text>
        <Text textStyle="t3Regular" color="fg.neutralMuted">
          {issueKindHint(issue.kind)}
        </Text>
      </VStack>

      {isOpen(issue) ? (
        <HStack gap="x2" wrap="wrap">
          <ActionButton variant="brandSolid" size="small" loading={busy === "done"} disabled={busy !== null} onClick={() => void change("done")}>
            {t("처리 완료", "Resolved")}
          </ActionButton>
          {issue.status !== "checking" ? (
            <ActionButton variant="neutralWeak" size="small" loading={busy === "checking"} disabled={busy !== null} onClick={() => void change("checking")}>
              {t("확인 중", "Checking")}
            </ActionButton>
          ) : null}
          <ActionButton variant="neutralWeak" size="small" loading={busy === "not-issue"} disabled={busy !== null} onClick={() => void change("not-issue")}>
            {t("문제 아님", "Not an issue")}
          </ActionButton>
        </HStack>
      ) : (
        <Text textStyle="t3Regular" color="fg.neutralMuted">
          <MetaLine items={[alertStatusLabel(issue.status), issue.at]} />
        </Text>
      )}
      {error ? <Callout tone="critical" description={error} /> : null}
      {issue.onSlack ? (
        <Text textStyle="t2Regular" color="fg.neutralSubtle">
          {t("슬랙 메시지도 같은 상태로 바뀌어요.", "The Slack message updates to the same status.")}
        </Text>
      ) : null}

      <dl className="issues-facts">
        <dt>{t("화면", "Screen")}</dt>
        <dd>
          <code>{issue.path}</code>
        </dd>
        <dt>{t("빌드·기기", "Build · device")}</dt>
        <dd>
          <MetaLine items={[issue.build, issue.device]} />
        </dd>
        <dt>{t("알림", "Alert")}</dt>
        <dd>
          <MetaLine items={[shortTime(issue.sentAt), issue.onSlack ? t("슬랙으로 보냄", "Sent to Slack") : t("요약으로 묶음", "Grouped in summary")]} />
        </dd>
      </dl>

      {issue.items ? (
        <VStack gap="x2">
          {issue.items.map((item) => (
            <VStack key={item.path} gap="x1">
              <Text textStyle="t3Bold">
                <code>{item.path}</code>
              </Text>
              <ul className="issues-texts">
                {item.texts.map((text) => (
                  <li key={text}>{`「${text}」`}</li>
                ))}
              </ul>
            </VStack>
          ))}
        </VStack>
      ) : (
        <Text textStyle="t4Regular" className="issues-detail-text">
          {issue.detail || "-"}
        </Text>
      )}

      {issue.links.length > 0 ? (
        <HStack gap="x3" wrap="wrap">
          {issue.links.map((link) => (
            <a key={link.url} href={link.url} target="_blank" rel="noreferrer" className="issues-link">
              {link.label}
            </a>
          ))}
        </HStack>
      ) : null}

      {issue.screenshot ? <img className="issues-shot" src={resultFileUrl(issue.screenshot)} alt={t(`${issue.path} 점검 때 화면`, `${issue.path} during the check`)} /> : null}
    </section>
  );
}

/** 「문제」: 앱 오류·동작 오류·정책 위반·디자인 오류·문서 갱신·확인 필요를 한 목록에서 보고 처리한다 */
export function IssuesScreen({ initialKind = null }: { initialKind?: IssueKind | null }) {
  const state = usePoll(api.issues, issuesPollMs);
  const [kind, setKind] = useState<IssueKind | null>(initialKind);
  const [status, setStatus] = useState<StatusFilter>("open");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const issues = state.data ?? [];
  const shown = useMemo(() => issues.filter((issue) => matches(issue, kind, status)), [issues, kind, status]);
  const selected = shown.find((issue) => issue.key === selectedKey) ?? shown[0] ?? null;

  if (state.data === undefined) {
    return state.error ? (
      <Callout tone="critical" description={state.error} />
    ) : (
      <LoadingState />
    );
  }

  return (
    <VStack gap="x4" className="issues-page">
      <VStack gap="x1">
        <Text as="h1" textStyle="t7Bold">
          {t(`남은 문제 ${issues.filter(isOpen).length}개`, `${plural(issues.filter(isOpen).length, "open problem")}`)}
        </Text>
        <Text textStyle="t4Regular" color="fg.neutralMuted">
          {t("점검이 찾은 문제를 한곳에 모았어요. 처리하면 슬랙 메시지도 같이 바뀌어요.", "Problems found by checks, in one place. Resolving one also updates its Slack message.")}
        </Text>
      </VStack>
      <KindFilter issues={issues} kind={kind} onChange={setKind} />
      <HStack gap="x3" align="center" justify="space-between" wrap="wrap">
        <Text as="h2" textStyle="t5Bold">
          {t(`${kind ? issueKindLabel(kind) : "모든 문제"} ${shown.length}개`, `${kind ? issueKindLabel(kind) : "All problems"} (${shown.length})`)}
        </Text>
        <SegmentedControl aria-label={t("상태", "Status")} value={status} onValueChange={(value) => setStatus(value as StatusFilter)}>
          {statusFilterIds.map((item) => (
            <SegmentedControlItem key={item} value={item}>
              {statusFilterLabel(item)}
            </SegmentedControlItem>
          ))}
        </SegmentedControl>
      </HStack>
      {shown.length === 0 ? (
        <div className="issues-empty">
          <Text textStyle="t5Bold">{status === "open" ? t("남은 문제가 없어요", "No open problems") : t("문제가 없어요", "No problems")}</Text>
          <Text textStyle="t3Regular" color="fg.neutralMuted">
            {t("점검에서 문제가 나오면 여기와 슬랙에 같이 올라와요.", "When a check finds a problem, it shows up here and in Slack.")}
          </Text>
        </div>
      ) : (
        <div className="issues-split">
          <nav className="issues-list" aria-label={t("문제 목록", "Problem list")}>
            {shown.map((issue) => (
              <IssueRow key={issue.key} issue={issue} selected={issue.key === selected?.key} onSelect={() => setSelectedKey(issue.key)} />
            ))}
          </nav>
          {selected ? <IssueDetail key={selected.key} issue={selected} onChanged={state.reload} /> : null}
        </div>
      )}
    </VStack>
  );
}

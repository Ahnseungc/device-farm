import { useMemo, useState } from "react";
import { HStack, Text, VStack } from "@seed-design/react";
import { IconChevronRightLine } from "@karrotmarket/react-monochrome-icon";

import { isRecentlyChanged, recentPolicyDays, type PolicyChangeKind, type PolicyPage, type PolicyRulesSummary, type PolicyWatchState } from "@device-farm/core/policy/snapshot";

import { api, errorMessage, usePoll } from "./api-client";
import { FloatingNotice, type Notice } from "./floating-notice";
import { dateLocale, t } from "./i18n";
import { LoadingState } from "./loading-state";
import { MetaLine } from "./meta-line";
import { RuleList } from "./policy-rules";
import { ActionButton } from "./seed-design/ui/action-button";
import { Badge, type BadgeProps } from "./seed-design/ui/badge";
import { Callout } from "./seed-design/ui/callout";
import { TextField, TextFieldInput } from "./seed-design/ui/text-field";
import "./policy.css";

const kindLabel = (kind: PolicyChangeKind): string => ({ added: t("추가", "Added"), changed: t("변경", "Changed"), removed: t("삭제", "Removed") })[kind];
const kindTones = { added: "positive", changed: "informative", removed: "critical" } as const satisfies Record<PolicyChangeKind, BadgeProps["tone"]>;

const dateTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(dateLocale(), { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : t("아직 없음", "Not yet");
const date = (iso: string) => new Date(iso).toLocaleDateString(dateLocale(), { year: "2-digit", month: "numeric", day: "numeric" });

/** 설정이 빠졌거나 실패한 것만 한 줄씩. 문제가 없으면 아무것도 안 보인다 */
function Warnings({ state }: { state: PolicyWatchState }) {
  const lines = [
    !state.configured
      ? t("CONFLUENCE_EMAIL·CONFLUENCE_API_TOKEN이 .env에 없어 정책을 확인하지 않아요.", "CONFLUENCE_EMAIL and CONFLUENCE_API_TOKEN are missing from .env, so policies are not checked.")
      : null,
    state.lastError ? `${t("마지막 확인 실패", "Last check failed")}: ${state.lastError}` : null,
    state.failed.length > 0
      ? t(`읽지 못한 정책 ${state.failed.length}개: `, `${state.failed.length} policies could not be read: `) + state.failed.map((item) => item.id).join(", ")
      : null,
    state.extractFailed.length > 0
      ? t(`규칙을 못 뽑은 정책 ${state.extractFailed.length}개: `, `Rule extraction failed for ${state.extractFailed.length} policies: `) + state.extractFailed[0].message
      : null,
    !state.figmaConfigured ? t("FIGMA_TOKEN이 .env에 없어 피그마 문구는 비교하지 않아요.", "FIGMA_TOKEN is missing from .env, so Figma copy is not compared.") : null,
  ].filter((line): line is string => line !== null);
  return lines.length > 0 ? <Callout tone="warning" description={lines.join("\n")} /> : null;
}

/** 정책 한 줄: 이름(Confluence 링크) · 버전·수정일 · 규칙·화면 수. 누르면 뽑은 규칙이 펼쳐진다 */
function PolicyRow({ page, rules, open, onToggle }: { page: PolicyPage; rules: PolicyRulesSummary | undefined; open: boolean; onToggle: () => void }) {
  return (
    <li className="pol-row">
      <button type="button" className="pol-row-head" aria-expanded={open} onClick={onToggle}>
        <VStack gap="x0_5" className="pol-row-body">
          <HStack gap="x1_5" align="center" wrap="wrap">
            <Text textStyle="t4Bold">{page.title}</Text>
            {isRecentlyChanged(page) ? (
              <Badge tone="informative" variant="weak">
                {t(`${recentPolicyDays}일 안 수정`, `Changed within ${recentPolicyDays} days`)}
              </Badge>
            ) : null}
          </HStack>
          <Text textStyle="t3Regular" color="fg.neutralSubtle">
            <MetaLine
              items={[
                `v${page.version}`,
                t(`${date(page.modifiedAt)} 수정`, `Changed ${date(page.modifiedAt)}`),
                rules ? t(`규칙 ${rules.rules.length}개`, `${rules.rules.length} rules`) : t("규칙 아직 없음", "No rules yet"),
                rules ? t(`화면 ${rules.screens.length}곳`, `${rules.screens.length} screens`) : null,
                rules && rules.figma > 0 ? t(`피그마 ${rules.figma}`, `Figma ${rules.figma}`) : null,
              ]}
            />
          </Text>
        </VStack>
        <span className="pol-row-chevron" aria-hidden="true">
          <IconChevronRightLine size="1em" />
        </span>
      </button>
      {open ? (
        <div className="pol-row-detail">
          <a className="pol-link" href={page.webUrl} target="_blank" rel="noreferrer">
            {t("Confluence 정책서 열기", "Open the Confluence policy")}
          </a>
          {rules ? <RuleList page={rules} /> : <Text color="fg.neutralMuted">{t("아직 규칙을 뽑지 않았어요. 다음 확인 때 뽑아요.", "No rules extracted yet. They will be extracted at the next check.")}</Text>}
        </div>
      ) : null}
    </li>
  );
}

/** 「정책 규칙」: Confluence 정책에서 Claude가 뽑은 규칙. 어긋남은 「문제」에서 본다 */
export function PolicyScreen() {
  const state = usePoll(api.policy);
  const [openId, setOpenId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const rulesById = useMemo(() => new Map((state.data?.rules ?? []).map((page) => [page.pageId, page])), [state.data]);
  const pages = useMemo(() => {
    const keyword = query.trim();
    const all = state.data?.pages ?? [];
    return keyword ? all.filter((page) => page.title.includes(keyword)) : all;
  }, [state.data, query]);

  async function check() {
    setBusy(true);
    try {
      await api.checkPolicy();
      setNotice({ text: t("정책을 확인하고 있어요. 바뀐 정책만 규칙을 다시 뽑아요.", "Checking policies. Rules are re-extracted only for policies that changed."), error: false });
      await state.reload();
    } catch (error) {
      setNotice({ text: errorMessage(error), error: true });
    } finally {
      setBusy(false);
    }
  }

  if (state.data === undefined) return state.error ? <Callout tone="critical" description={state.error} /> : <LoadingState />;
  if (state.data === null) return <Callout tone="warning" description={t("디바이스팜 서버가 아직 정책 감시를 시작하지 않았어요.", "The device farm server has not started watching policies yet.")} />;
  const data = state.data;
  const ruleCount = data.rules.reduce((sum, page) => sum + page.rules.length, 0);
  const status = data.progress
    ? `${t("규칙 뽑는 중", "Extracting rules")} ${data.progress.done + 1}/${data.progress.total}`
    : data.running
      ? t("확인 중", "Checking")
      : t(`${dateTime(data.checkedAt)} 확인`, `Checked ${dateTime(data.checkedAt)}`);

  return (
    <VStack gap="x5" className="pol-page">
      <FloatingNotice notice={notice} onClose={() => setNotice(null)} />
      <HStack justify="space-between" align="flex-end" gap="x3" wrap="wrap">
        <VStack gap="x1">
          <Text as="h1" textStyle="t7Bold">
            {t("정책 규칙", "Policy rules")}
          </Text>
          <Text textStyle="t4Regular" color="fg.neutralMuted">
            {t(
              "Confluence 정책서에서 Claude가 화면에서 확인할 규칙을 뽑아요. 매일 02:00에 바뀐 정책만 다시 뽑아요.",
              "Claude extracts rules to check on screen from Confluence policy docs. Every day at 02:00 it re-extracts only the policies that changed.",
            )}
          </Text>
        </VStack>
        <ActionButton variant="brandSolid" size="medium" loading={busy || data.running} disabled={!data.configured || busy || data.running} onClick={() => void check()}>
          {t("지금 확인", "Check now")}
        </ActionButton>
      </HStack>

      <div className="pol-stats">
        {[
          [t("정책", "Policies"), String(data.pages.length)],
          [t("뽑은 규칙", "Extracted rules"), String(ruleCount)],
          [t(`최근 ${recentPolicyDays}일 수정`, `Changed in ${recentPolicyDays} days`), String(data.pages.filter((page) => isRecentlyChanged(page)).length)],
          [t("상태", "Status"), status],
        ].map(([label, value]) => (
          <div key={label} className="pol-stat">
            <Text textStyle="t3Regular" color="fg.neutralSubtle">
              {label}
            </Text>
            <Text textStyle="t5Bold">{value}</Text>
          </div>
        ))}
      </div>
      <Warnings state={data} />
      <Text textStyle="t3Regular" color="fg.neutralSubtle">
        {t(
          `다음 확인은 ${dateTime(data.nextAt)}이에요. 화면과 다른 점은 「문제」 메뉴에서 볼 수 있어요.`,
          `Next check: ${dateTime(data.nextAt)}. Differences from the screens are listed under Problems.`,
        )}
      </Text>

      <VStack gap="x3">
        <div className="pol-search">
          <TextField label={t("정책 찾기", "Search policies")} value={query} onValueChange={({ value }) => setQuery(value)}>
            <TextFieldInput placeholder={t("예: 결제, 회원가입, 알림", "e.g. payment, sign-up, notifications")} />
          </TextField>
        </div>
        <ul className="pol-list">
          {pages.map((page) => (
            <PolicyRow key={page.id} page={page} rules={rulesById.get(page.id)} open={openId === page.id} onToggle={() => setOpenId(openId === page.id ? null : page.id)} />
          ))}
        </ul>
        {pages.length === 0 ? <Text color="fg.neutralMuted">{t(`「${query.trim()}」에 맞는 정책이 없어요.`, `No policies match “${query.trim()}”.`)}</Text> : null}
      </VStack>

      <details className="pol-changes">
        <summary>{t(`바뀜 기록(최근 ${data.changes.length}개)`, `Change history (latest ${data.changes.length})`)}</summary>
        <ul className="pol-change-list">
          {data.changes.map((change) => (
            <li key={`${change.at}-${change.id}-${change.kind}`}>
              <Badge tone={kindTones[change.kind]} variant="weak">
                {kindLabel(change.kind)}
              </Badge>
              <Text textStyle="t4Medium">{change.title}</Text>
              <Text textStyle="t3Regular" color="fg.neutralSubtle">
                <MetaLine items={[`${change.fromVersion ? `v${change.fromVersion} → ` : ""}v${change.version}`, dateTime(change.at)]} />
              </Text>
            </li>
          ))}
        </ul>
      </details>
    </VStack>
  );
}

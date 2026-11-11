import { useState } from "react";

import { HStack, Text, VStack } from "@seed-design/react";

import { isRecentlyChanged, recentPolicyDays, type PolicyChangeKind, type PolicyWatchState } from "@device-farm/core/policy/snapshot";

import { api, errorMessage, usePoll } from "./api-client";
import { ActionButton } from "./seed-design/ui/action-button";
import { Badge, type BadgeProps } from "./seed-design/ui/badge";
import { Callout } from "./seed-design/ui/callout";
import { ProgressCircle } from "./seed-design/ui/progress-circle";
import { PolicyFindingsCard, PolicyRulesCard } from "./policy-findings";
import "./policy.css";

const kindLabels = { added: "추가", changed: "변경", removed: "삭제" } as const satisfies Record<PolicyChangeKind, string>;
const kindTones = { added: "positive", changed: "informative", removed: "critical" } as const satisfies Record<PolicyChangeKind, BadgeProps["tone"]>;

const dateTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "아직 없음");
const date = (iso: string) => new Date(iso).toLocaleDateString("ko-KR");

function StatusCard({ state, onChecked }: { state: PolicyWatchState; onChecked: () => void }) {
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  async function check() {
    setBusy(true);
    try {
      await api.checkPolicy();
      setMessage({ text: "정책을 확인하고 있어요. 끝나면 목록이 바뀌어요.", error: false });
      onChecked();
    } catch (error) {
      setMessage({ text: errorMessage(error), error: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="policy-card" aria-label="정책 감시 상태">
      <VStack gap="x0_5">
        <Text as="h2" textStyle="t5Bold">정책 바뀜 감지</Text>
        <Text textStyle="t3Regular" color="fg.neutralSubtle">
          매일 새벽 2시에 Confluence 정책 본문을 비교하고, 바뀐 정책만 Claude가 규칙을 다시 뽑아요. 근거 인용이 본문에 없는 규칙은 버려요. 뽑은 규칙은 점검 때 화면 문구·피그마와 맞춰 봐요.
        </Text>
      </VStack>
      <div className="policy-stats">
        {[
          ["마지막 확인", state.progress ? `규칙 뽑는 중 ${state.progress.done + 1}/${state.progress.total}` : state.running ? "확인 중" : dateTime(state.checkedAt)],
          ["다음 확인", dateTime(state.nextAt)],
          ["정책 수", String(state.pages.length)],
          [`최근 ${recentPolicyDays}일 수정`, String(state.pages.filter((page) => isRecentlyChanged(page)).length)],
        ].map(([label, value]) => (
          <div key={label} className="policy-stat">
            <Text textStyle="t3Regular" color="fg.neutralSubtle">{label}</Text>
            <Text textStyle="t5Bold">{value}</Text>
          </div>
        ))}
      </div>
      <HStack gap="x2" align="center" wrap="wrap">
        <ActionButton variant="neutralSolid" size="medium" loading={busy || state.running} disabled={!state.configured || busy || state.running} onClick={() => void check()}>
          지금 확인
        </ActionButton>
        {state.running ? <ProgressCircle aria-label="확인 중" /> : null}
      </HStack>
      {!state.configured ? <Callout tone="warning" description="CONFLUENCE_EMAIL·CONFLUENCE_API_TOKEN이 .env에 없어 정책을 확인하지 않아요." /> : null}
      {state.lastError ? <Callout tone="critical" description={`마지막 확인 실패: ${state.lastError}`} /> : null}
      {state.failed.length > 0 ? <Callout tone="warning" description={`읽지 못한 정책 ${state.failed.length}개: ${state.failed.map((item) => `${item.id}(${item.message})`).join(", ")}`} /> : null}
      {state.extractFailed.length > 0 ? <Callout tone="warning" description={`규칙을 못 뽑은 정책 ${state.extractFailed.length}개: ${state.extractFailed[0].message}`} /> : null}
      {!state.figmaConfigured ? <Callout tone="informative" description="FIGMA_TOKEN이 .env에 없어 피그마 문구는 비교하지 않아요." /> : null}
      {message ? <Callout tone={message.error ? "critical" : "informative"} description={message.text} /> : null}
    </section>
  );
}

function ChangesCard({ state }: { state: PolicyWatchState }) {
  const linkOf = new Map(state.pages.map((page) => [page.id, page.webUrl]));
  return (
    <section className="policy-card" aria-label="바뀜 기록">
      <Text as="h3" textStyle="t4Bold">{`바뀜 기록 · 최근 ${state.changes.length}개`}</Text>
      {state.changes.length === 0 ? <Text color="fg.neutralMuted">아직 기록이 없어요.</Text> : null}
      <ul className="policy-list">
        {state.changes.map((change) => (
          <li key={`${change.at}-${change.id}-${change.kind}`} className="policy-row">
            <Badge tone={kindTones[change.kind]} variant="weak">{kindLabels[change.kind]}</Badge>
            {linkOf.has(change.id) ? (
              <a className="policy-title" href={linkOf.get(change.id)} target="_blank" rel="noreferrer">{change.title}</a>
            ) : (
              <Text textStyle="t4Medium" className="policy-title">{change.title}</Text>
            )}
            <Text textStyle="t3Regular" color="fg.neutralSubtle">
              {`${change.fromVersion ? `v${change.fromVersion} → ` : ""}v${change.version} · ${dateTime(change.at)} 감지`}
            </Text>
          </li>
        ))}
      </ul>
    </section>
  );
}

function PagesCard({ state }: { state: PolicyWatchState }) {
  return (
    <section className="policy-card" aria-label="정책 목록">
      <Text as="h3" textStyle="t4Bold">{`정책 ${state.pages.length}개 · 최근 수정 순`}</Text>
      <ul className="policy-list">
        {state.pages.map((page) => (
          <li key={page.id} className="policy-row">
            {isRecentlyChanged(page) ? <Badge tone="informative" variant="weak">{`${recentPolicyDays}일 안`}</Badge> : <span className="policy-badge-space" />}
            <a className="policy-title" href={page.webUrl} target="_blank" rel="noreferrer">{page.title}</a>
            <Text textStyle="t3Regular" color="fg.neutralSubtle">{`v${page.version} · ${date(page.modifiedAt)}`}</Text>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** 정책 바뀜 감지·규칙 뽑기·화면 대조 결과(docs/design-policy-figma.md) */
export function PolicyScreen() {
  const state = usePoll(api.policy);
  if (state.data === undefined) {
    return state.error ? <Callout tone="critical" description={state.error} /> : <ProgressCircle aria-label="불러오는 중" />;
  }
  if (state.data === null) return <Callout tone="warning" description="디바이스팜 서버가 아직 정책 감시를 시작하지 않았어요." />;
  return (
    <VStack gap="x4" className="policy-page">
      <StatusCard state={state.data} onChecked={() => void state.reload()} />
      <PolicyFindingsCard />
      <PolicyRulesCard pages={state.data.rules} />
      <ChangesCard state={state.data} />
      <PagesCard state={state.data} />
    </VStack>
  );
}

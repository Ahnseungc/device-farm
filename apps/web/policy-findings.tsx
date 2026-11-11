import { useState } from "react";

import { HStack, Text, VStack } from "@seed-design/react";

import type { PolicyCheck, PolicyIgnore } from "@device-farm/core/policy/compare";
import type { PolicyRuleKind } from "@device-farm/core/policy/rules";
import { isRecentlyChanged, type PolicyRulesSummary } from "@device-farm/core/policy/snapshot";

import { api, errorMessage, usePoll } from "./api-client";
import { ActionButton } from "./seed-design/ui/action-button";
import { Badge } from "./seed-design/ui/badge";
import { Callout } from "./seed-design/ui/callout";
import { TextField, TextFieldInput } from "./seed-design/ui/text-field";

const policyPrefix = "정책 · ";
const kindLabels = { copy: "문구", value: "값", behavior: "동작" } as const satisfies Record<PolicyRuleKind, string>;

/** 무시 버튼. 이유 한 줄을 받아 `policy/ignored.json`에 남긴다 */
function IgnoreControl({ ignoreKey, hash, ignored, onChanged }: { ignoreKey: string; hash: string; ignored: boolean; onChanged: () => void }) {
  const [reason, setReason] = useState("");
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(action: () => Promise<unknown>) {
    try {
      await action();
      setOpen(false);
      setError(null);
      onChanged();
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  if (ignored) {
    return (
      <ActionButton variant="neutralWeak" size="small" onClick={() => void submit(() => api.unignorePolicy({ key: ignoreKey, hash }))}>
        무시 풀기
      </ActionButton>
    );
  }
  if (!open) {
    return (
      <ActionButton variant="neutralWeak" size="small" onClick={() => setOpen(true)}>
        무시
      </ActionButton>
    );
  }
  return (
    <VStack gap="x1" className="policy-ignore">
      <HStack gap="x1" align="flex-end">
        <TextField label="무시 이유" value={reason} onValueChange={({ value }) => setReason(value)}>
          <TextFieldInput placeholder="토스트 문구라 열자마자 안 보임" />
        </TextField>
        <ActionButton variant="neutralSolid" size="small" disabled={!reason.trim()} onClick={() => void submit(() => api.ignorePolicy({ key: ignoreKey, hash, reason: reason.trim() }))}>
          저장
        </ActionButton>
      </HStack>
      {error ? <Text textStyle="t3Regular" color="fg.critical">{error}</Text> : null}
    </VStack>
  );
}

const isIgnoredNow = (items: readonly PolicyIgnore[], check: Pick<PolicyCheck, "ignoreKey" | "ignoreHash">) =>
  items.some((item) => item.key === check.ignoreKey && item.hash === check.ignoreHash);

/** 마지막 점검의 정책 화면별 어긋남. 통과한 규칙은 수만 보인다 */
export function PolicyFindingsCard() {
  const run = usePoll(api.latestRun);
  const ignored = usePoll(api.policyIgnored);
  const items = ignored.data?.items ?? [];
  const screens = (run.data?.outcomes ?? []).flatMap((outcome) =>
    outcome.screens.filter((screen) => screen.scenario.startsWith(policyPrefix)).map((screen) => ({ device: outcome.device.model, screen })),
  );
  return (
    <section className="policy-card" aria-label="마지막 점검의 정책 어긋남">
      <Text as="h3" textStyle="t4Bold">마지막 점검의 정책·피그마 어긋남</Text>
      {run.error ? <Callout tone="critical" description={run.error} /> : null}
      {screens.length === 0 ? <Text color="fg.neutralMuted">정책 화면을 본 점검이 아직 없어요. 규칙을 뽑은 뒤 점검을 돌리면 여기에 나와요.</Text> : null}
      {screens.map(({ device, screen }) => {
        const checks = (screen.checks ?? []) as PolicyCheck[];
        const open = checks.filter((check) => !check.ok);
        return (
          <VStack key={`${device}-${screen.scenario}`} gap="x2" className="policy-screen">
            <HStack gap="x2" align="center" wrap="wrap">
              <Badge tone={screen.status === "failed" ? "critical" : open.length > 0 ? "warning" : "positive"} variant="weak">
                {screen.status === "failed" ? "버그 후보" : open.length > 0 ? "어긋남" : "통과"}
              </Badge>
              <Text textStyle="t4Bold">{screen.scenario.slice(policyPrefix.length)}</Text>
              <Text textStyle="t3Regular" color="fg.neutralSubtle">{`${device} · 규칙 ${checks.length - open.length}개 통과`}</Text>
            </HStack>
            {screen.message ? <Text textStyle="t3Regular" color="fg.neutralSubtle">{screen.message}</Text> : null}
            <ul className="policy-list">
              {open.map((check) => {
                const nowIgnored = isIgnoredNow(items, check);
                return (
                  <li key={check.id} className="policy-finding">
                    <VStack gap="x0_5" className="policy-finding-body">
                      <Text textStyle="t4Medium" color={nowIgnored ? "fg.neutralMuted" : undefined}>{check.title}</Text>
                      <Text textStyle="t3Regular" color={nowIgnored ? "fg.neutralMuted" : "fg.critical"}>{check.message}</Text>
                    </VStack>
                    {check.ignoreKey && check.ignoreKey !== "open" ? (
                      <IgnoreControl ignoreKey={check.ignoreKey} hash={check.ignoreHash} ignored={nowIgnored} onChanged={() => void ignored.reload()} />
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </VStack>
        );
      })}
    </section>
  );
}

/** 정책별로 뽑은 규칙. 근거 인용과 버린 후보를 같이 보여 준다 */
export function PolicyRulesCard({ pages }: { pages: PolicyRulesSummary[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const total = pages.reduce((sum, page) => sum + page.rules.length, 0);
  return (
    <section className="policy-card" aria-label="뽑은 규칙">
      <Text as="h3" textStyle="t4Bold">{`뽑은 규칙 · 정책 ${pages.length}개 · 규칙 ${total}개`}</Text>
      {pages.length === 0 ? <Text color="fg.neutralMuted">아직 뽑은 규칙이 없어요. 「지금 확인」을 누르면 바뀐 정책부터 Claude가 뽑아요.</Text> : null}
      <ul className="policy-list">
        {[...pages]
          .sort((a, b) => b.rules.length - a.rules.length)
          .map((page) => (
            <li key={page.pageId} className="policy-rule-page">
              <button type="button" className="policy-rule-toggle" aria-expanded={openId === page.pageId} onClick={() => setOpenId(openId === page.pageId ? null : page.pageId)}>
                <Text textStyle="t4Medium">{page.pageTitle}</Text>
                <Text textStyle="t3Regular" color="fg.neutralSubtle">
                  {`규칙 ${page.rules.length} · 버림 ${page.dropped.length} · 화면 ${page.screens.length} · 피그마 ${page.figma}`}
                </Text>
              </button>
              {openId === page.pageId ? <RuleList page={page} /> : null}
            </li>
          ))}
      </ul>
    </section>
  );
}

function RuleList({ page }: { page: PolicyRulesSummary }) {
  return (
    <VStack gap="x2" className="policy-rule-list">
      {page.screens.length > 0 ? <Text textStyle="t3Regular" color="fg.neutralSubtle">{`화면: ${page.screens.join(", ")}`}</Text> : null}
      {page.rules.map((rule) => (
        <VStack key={rule.id} gap="x0_5" className="policy-rule">
          <HStack gap="x1" align="center" wrap="wrap">
            <Badge tone="neutral" variant="weak">{kindLabels[rule.kind]}</Badge>
            {isRecentlyChanged({ modifiedAt: rule.since }) ? <Badge tone="informative" variant="weak">앱 반영 전</Badge> : null}
            {!rule.visibleOnOpen && rule.kind !== "behavior" ? <Badge tone="neutral" variant="weak">상황 필요</Badge> : null}
            <Text textStyle="t4Medium">{rule.statement}</Text>
          </HStack>
          {rule.expected ? <Text textStyle="t3Regular">{`기대: 「${rule.expected}」`}</Text> : null}
          <Text textStyle="t3Regular" color="fg.neutralSubtle">{`근거: ${rule.evidence}`}</Text>
          {rule.screens.length > 0 ? <Text textStyle="t3Regular" color="fg.neutralSubtle">{rule.screens.join(", ")}</Text> : null}
        </VStack>
      ))}
      {page.dropped.length > 0 ? (
        <VStack gap="x0_5">
          <Text textStyle="t3Bold" color="fg.neutralMuted">{`버린 후보 ${page.dropped.length}개`}</Text>
          {page.dropped.map((item, index) => (
            <Text key={index} textStyle="t3Regular" color="fg.neutralMuted">{`${item.statement} — ${item.reason}`}</Text>
          ))}
        </VStack>
      ) : null}
    </VStack>
  );
}

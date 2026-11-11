import { useState } from "react";

import { HStack, Text, VStack } from "@seed-design/react";

import type { PolicyCheck, PolicyIgnore } from "@device-farm/core/policy/compare";
import type { PolicyRuleKind } from "@device-farm/core/policy/rules";
import { isRecentlyChanged, type PolicyRulesSummary } from "@device-farm/core/policy/snapshot";

import { api, errorMessage, usePoll } from "./api-client";
import { plural, t } from "./i18n";
import { ActionButton } from "./seed-design/ui/action-button";
import { Badge } from "./seed-design/ui/badge";
import { Callout } from "./seed-design/ui/callout";
import { TextField, TextFieldInput } from "./seed-design/ui/text-field";

/** 정책 화면 점검 이름 머리말. 엔진은 「정책 · 」, 영어 데모 데이터는 「Policy · 」 */
const policyPrefixes = ["정책 · ", "Policy · "];
const policyPrefixOf = (scenario: string) => policyPrefixes.find((prefix) => scenario.startsWith(prefix));
const kindLabel = (kind: PolicyRuleKind): string => ({ copy: t("문구", "Copy"), value: t("값", "Value"), behavior: t("동작", "Behavior") })[kind];

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
        {t("무시 풀기", "Unignore")}
      </ActionButton>
    );
  }
  if (!open) {
    return (
      <ActionButton variant="neutralWeak" size="small" onClick={() => setOpen(true)}>
        {t("무시", "Ignore")}
      </ActionButton>
    );
  }
  return (
    <VStack gap="x1" className="policy-ignore">
      <HStack gap="x1" align="flex-end">
        <TextField label={t("무시 이유", "Reason to ignore")} value={reason} onValueChange={({ value }) => setReason(value)}>
          <TextFieldInput placeholder={t("토스트 문구라 열자마자 안 보임", "Toast copy, not visible on open")} />
        </TextField>
        <ActionButton variant="neutralSolid" size="small" disabled={!reason.trim()} onClick={() => void submit(() => api.ignorePolicy({ key: ignoreKey, hash, reason: reason.trim() }))}>
          {t("저장", "Save")}
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
    outcome.screens.filter((screen) => policyPrefixOf(screen.scenario) !== undefined).map((screen) => ({ device: outcome.device.model, screen })),
  );
  return (
    <section className="policy-card" aria-label={t("마지막 점검의 정책 어긋남", "Policy mismatches in the latest check")}>
      <Text as="h3" textStyle="t4Bold">{t("마지막 점검의 정책·피그마 어긋남", "Policy and Figma mismatches in the latest check")}</Text>
      {run.error ? <Callout tone="critical" description={run.error} /> : null}
      {screens.length === 0 ? <Text color="fg.neutralMuted">{t("정책 화면을 본 점검이 아직 없어요. 규칙을 뽑은 뒤 점검을 돌리면 여기에 나와요.", "No check has covered a policy screen yet. Extract rules, then run a check; results show up here.")}</Text> : null}
      {screens.map(({ device, screen }) => {
        const checks = (screen.checks ?? []) as PolicyCheck[];
        const open = checks.filter((check) => !check.ok);
        return (
          <VStack key={`${device}-${screen.scenario}`} gap="x2" className="policy-screen">
            <HStack gap="x2" align="center" wrap="wrap">
              <Badge tone={screen.status === "failed" ? "critical" : open.length > 0 ? "warning" : "positive"} variant="weak">
                {screen.status === "failed" ? t("버그 후보", "Bug candidate") : open.length > 0 ? t("어긋남", "Mismatch") : t("통과", "Passed")}
              </Badge>
              <Text textStyle="t4Bold">{screen.scenario.slice(policyPrefixOf(screen.scenario)?.length ?? 0)}</Text>
              <Text textStyle="t3Regular" color="fg.neutralSubtle">{t(`${device} · 규칙 ${checks.length - open.length}개 통과`, `${device} · ${plural(checks.length - open.length, "rule")} passed`)}</Text>
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
    <section className="policy-card" aria-label={t("뽑은 규칙", "Extracted rules")}>
      <Text as="h3" textStyle="t4Bold">{t(`뽑은 규칙 · 정책 ${pages.length}개 · 규칙 ${total}개`, `Extracted rules · ${pages.length} policies · ${total} rules`)}</Text>
      {pages.length === 0 ? <Text color="fg.neutralMuted">{t("아직 뽑은 규칙이 없어요. 「지금 확인」을 누르면 바뀐 정책부터 Claude가 뽑아요.", "No rules extracted yet. Press “Check now” and Claude extracts them, starting with changed policies.")}</Text> : null}
      <ul className="policy-list">
        {[...pages]
          .sort((a, b) => b.rules.length - a.rules.length)
          .map((page) => (
            <li key={page.pageId} className="policy-rule-page">
              <button type="button" className="policy-rule-toggle" aria-expanded={openId === page.pageId} onClick={() => setOpenId(openId === page.pageId ? null : page.pageId)}>
                <Text textStyle="t4Medium">{page.pageTitle}</Text>
                <Text textStyle="t3Regular" color="fg.neutralSubtle">
                  {t(`규칙 ${page.rules.length} · 버림 ${page.dropped.length} · 화면 ${page.screens.length} · 피그마 ${page.figma}`, `Rules ${page.rules.length} · dropped ${page.dropped.length} · screens ${page.screens.length} · Figma ${page.figma}`)}
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
      {page.screens.length > 0 ? <Text textStyle="t3Regular" color="fg.neutralSubtle">{`${t("화면", "Screens")}: ${page.screens.join(", ")}`}</Text> : null}
      {page.rules.map((rule) => (
        <VStack key={rule.id} gap="x0_5" className="policy-rule">
          <HStack gap="x1" align="center" wrap="wrap">
            <Badge tone="neutral" variant="weak">{kindLabel(rule.kind)}</Badge>
            {isRecentlyChanged({ modifiedAt: rule.since }) ? <Badge tone="informative" variant="weak">{t("앱 반영 전", "Not in app yet")}</Badge> : null}
            {!rule.visibleOnOpen && rule.kind !== "behavior" ? <Badge tone="neutral" variant="weak">{t("상황 필요", "Needs setup")}</Badge> : null}
            <Text textStyle="t4Medium">{rule.statement}</Text>
          </HStack>
          {rule.expected ? <Text textStyle="t3Regular">{t(`기대: 「${rule.expected}」`, `Expected: “${rule.expected}”`)}</Text> : null}
          <Text textStyle="t3Regular" color="fg.neutralSubtle">{`${t("근거", "Evidence")}: ${rule.evidence}`}</Text>
          {rule.screens.length > 0 ? <Text textStyle="t3Regular" color="fg.neutralSubtle">{rule.screens.join(", ")}</Text> : null}
        </VStack>
      ))}
      {page.dropped.length > 0 ? (
        <VStack gap="x0_5">
          <Text textStyle="t3Bold" color="fg.neutralMuted">{t(`버린 후보 ${page.dropped.length}개`, `Dropped candidates: ${page.dropped.length}`)}</Text>
          {page.dropped.map((item, index) => (
            <Text key={index} textStyle="t3Regular" color="fg.neutralMuted">{`${item.statement} — ${item.reason}`}</Text>
          ))}
        </VStack>
      ) : null}
    </VStack>
  );
}

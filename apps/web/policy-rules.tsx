import { HStack, Text, VStack } from "@seed-design/react";

import type { PolicyRuleKind } from "@device-farm/core/policy/rules";
import { isRecentlyChanged, type PolicyRulesSummary } from "@device-farm/core/policy/snapshot";

import { t } from "./i18n";
import { Badge } from "./seed-design/ui/badge";

const kindLabel = (kind: PolicyRuleKind): string => ({ copy: t("문구", "Copy"), value: t("값", "Value"), behavior: t("동작", "Behavior") })[kind];

/** 정책 하나에서 뽑은 규칙·버린 후보 */
export function RuleList({ page }: { page: PolicyRulesSummary }) {
  return (
    <VStack gap="x2" className="policy-rule-list">
      {page.screens.length > 0 ? <Text textStyle="t3Regular" color="fg.neutralSubtle">{`${t("화면", "Screens")}: ${page.screens.join(", ")}`}</Text> : null}
      {page.rules.map((rule) => (
        <VStack key={rule.id} gap="x0_5" className="policy-rule">
          <HStack gap="x1" align="center" wrap="wrap">
            <Badge tone="neutral" variant="weak">{kindLabel(rule.kind)}</Badge>
            {isRecentlyChanged({ modifiedAt: rule.since }) ? <Badge tone="informative" variant="weak">{t("앱 반영 전", "Not in app yet")}</Badge> : null}
            {!rule.visibleOnOpen && rule.kind !== "behavior" ? <Badge tone="neutral" variant="weak">{t("상황 필요", "Needs context")}</Badge> : null}
            <Text textStyle="t4Medium">{rule.statement}</Text>
          </HStack>
          {rule.expected ? <Text textStyle="t3Regular">{t(`기대: 「${rule.expected}」`, `Expected: “${rule.expected}”`)}</Text> : null}
          <Text textStyle="t3Regular" color="fg.neutralSubtle">{`${t("근거", "Evidence")}: ${rule.evidence}`}</Text>
          {rule.screens.length > 0 ? <Text textStyle="t3Regular" color="fg.neutralSubtle">{rule.screens.join(", ")}</Text> : null}
        </VStack>
      ))}
      {page.dropped.length > 0 ? (
        <VStack gap="x0_5">
          <Text textStyle="t3Bold" color="fg.neutralMuted">{t(`버린 후보 ${page.dropped.length}개`, `${page.dropped.length} dropped candidates`)}</Text>
          {page.dropped.map((item, index) => (
            <Text key={index} textStyle="t3Regular" color="fg.neutralMuted">{`${item.statement} (${t("버린 이유", "dropped because")}: ${item.reason})`}</Text>
          ))}
        </VStack>
      ) : null}
    </VStack>
  );
}

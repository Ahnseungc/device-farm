import { useState } from "react";
import { HStack, Text, VStack } from "@seed-design/react";

import { LoadingState } from "./loading-state";
import { MetaLine } from "./meta-line";
import { FloatingNotice } from "./floating-notice";
import { api, candidateImageUrl, errorMessage, usePoll } from "./api-client";
import { t } from "./i18n";
import { ActionButton } from "./seed-design/ui/action-button";
import { Callout } from "./seed-design/ui/callout";
import { ResultSection } from "./seed-design/ui/result-section";
import "./baselines.css";

/** 후보 키 `model|osVersion|scenario`에서 기기 부분과 화면 이름을 나눈다. */
function splitKey(key: string): { device: string; scenario: string } {
  const parts = key.split("|");
  if (parts.length < 3) return { device: t("기타", "Other"), scenario: key };
  return { device: `${parts[0]} ${parts[1]}`, scenario: parts.slice(2).join("|") };
}

function groupByDevice(keys: string[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const key of keys) {
    const { device } = splitKey(key);
    groups.set(device, [...(groups.get(device) ?? []), key]);
  }
  return groups;
}

export function BaselinesScreen() {
  const pending = usePoll(api.pendingBaselines);
  const [selected, setSelected] = useState<string[]>([]);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const keys = pending.data ?? [];
  const chosen = selected.filter((key) => keys.includes(key));

  const toggle = (key: string) =>
    setSelected((current) => (current.includes(key) ? current.filter((item) => item !== key) : [...current, key]));

  async function confirm(names?: string[]) {
    setBusy(true);
    try {
      const { confirmed } = await api.confirmBaselines(names);
      setMessage({ text: t(`기준 화면 ${confirmed}개를 확정했어요. 다음 점검부터 이 화면과 비교해요.`, `Confirmed ${confirmed} baseline(s). The next check compares against them.`), error: false });
      setSelected([]);
      await pending.reload();
    } catch (error) {
      setMessage({ text: errorMessage(error), error: true });
    } finally {
      setBusy(false);
    }
  }

  if (pending.data === undefined) return pending.error ? <Callout tone="critical" description={pending.error} /> : <LoadingState />;

  return (
    <VStack gap="x5" className="baselines-page bl-page">
      <FloatingNotice notice={message} onClose={() => setMessage(null)} />
      <HStack justify="space-between" align="flex-end" gap="x3" wrap="wrap">
        <VStack gap="x1">
          <Text as="h1" textStyle="t7Bold">
            {keys.length > 0 ? t(`확정할 기준 화면 ${keys.length}개`, `${keys.length} baselines to confirm`) : t("기준 화면", "Baselines")}
          </Text>
          <Text textStyle="t4Regular" color="fg.neutralMuted">
            {t(
              "지난번과 화면이 달라졌는지 비교할 기준 사진이에요. 새 빌드에서 처음 본 화면은 여기 후보로 올라와요.",
              "Reference shots used to tell whether a screen changed. Screens seen for the first time in a new build show up here as candidates.",
            )}
          </Text>
        </VStack>
        {keys.length > 0 ? (
          <ActionButton variant="brandSolid" size="medium" loading={busy && chosen.length === 0} disabled={busy} onClick={() => void confirm()}>
            {t(`전부 확정 (${keys.length})`, `Confirm all (${keys.length})`)}
          </ActionButton>
        ) : null}
      </HStack>

      {keys.length === 0 ? (
        <div className="baselines-card">
          <ResultSection size="medium" title={t("확정할 후보가 없어요", "Nothing to confirm")} description={t("새 빌드를 점검하면 처음 본 화면이 후보로 올라와요.\n맞는 화면이면 확정해 다음 점검의 기준으로 써요.", "Checking a new build adds screens seen for the first time as candidates.\nConfirm the right ones to use as the baseline for the next check.")} />
        </div>
      ) : null}

      {[...groupByDevice(keys)].map(([device, deviceKeys]) => (
        <section key={device} className="bl-group" aria-label={t(`${device} 기준 후보`, `${device} baseline candidates`)}>
          <Text as="h2" textStyle="t5Bold"><MetaLine items={[device, t(`${deviceKeys.length}개`, String(deviceKeys.length))]} /></Text>
          <div className="baselines-grid">
            {deviceKeys.map((key) => {
              const { scenario } = splitKey(key);
              const checked = chosen.includes(key);
              return (
                <button key={key} type="button" className="bl-tile" aria-pressed={checked} onClick={() => toggle(key)}>
                  <span className="bl-shot-wrap">
                    <img src={candidateImageUrl(key)} alt={t(`${scenario} 후보 화면`, `${scenario} candidate screen`)} className="baselines-shot" loading="lazy" />
                    <span className="bl-check" aria-hidden="true">
                      ✓
                    </span>
                  </span>
                  <Text textStyle="t3Medium" className="bl-name">
                    {scenario}
                  </Text>
                </button>
              );
            })}
          </div>
        </section>
      ))}

      {/* 고르면 아래에 떠서 본문을 밀지 않는다 */}
      {chosen.length > 0 ? (
        <div className="bl-bar" role="region" aria-label={t("고른 후보", "Selected candidates")}>
          <Text textStyle="t4Bold">{t(`${chosen.length}개 골랐어요`, `${chosen.length} selected`)}</Text>
          <HStack gap="x2">
            <ActionButton variant="ghost" size="medium" onClick={() => setSelected([])}>
              {t("고르기 취소", "Clear selection")}
            </ActionButton>
            <ActionButton variant="brandSolid" size="medium" loading={busy} disabled={busy} onClick={() => void confirm(chosen)}>
              {t("확정하기", "Confirm")}
            </ActionButton>
          </HStack>
        </div>
      ) : null}
    </VStack>
  );
}

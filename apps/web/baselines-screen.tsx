import { useState } from "react";
import { HStack, Text, VStack } from "@seed-design/react";

import { api, candidateImageUrl, errorMessage, usePoll } from "./api-client";
import { ActionButton } from "./seed-design/ui/action-button";
import { Badge } from "./seed-design/ui/badge";
import { Callout } from "./seed-design/ui/callout";
import { Checkbox } from "./seed-design/ui/checkbox";
import { ProgressCircle } from "./seed-design/ui/progress-circle";
import { ResultSection } from "./seed-design/ui/result-section";
import "./baselines.css";

/** 후보 키 `model|osVersion|scenario`에서 기기 부분과 화면 이름을 나눈다. */
function splitKey(key: string): { device: string; scenario: string } {
  const parts = key.split("|");
  if (parts.length < 3) return { device: "기타", scenario: key };
  return { device: `${parts[0]} · ${parts[1]}`, scenario: parts.slice(2).join("|") };
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
      setMessage({ text: `기준 화면 ${confirmed}개를 확정했습니다.`, error: false });
      setSelected([]);
      await pending.reload();
    } catch (error) {
      setMessage({ text: errorMessage(error), error: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <VStack gap="x4" className="baselines-page">
      <div className="baselines-toolbar">
        <VStack gap="x0_5">
          <Text as="h2" textStyle="t5Bold">
            기준 후보
          </Text>
          <Text textStyle="t3Regular" color="fg.neutralSubtle">
            {keys.length > 0 ? `후보 ${keys.length}개 · 고른 ${chosen.length}개` : "확정할 후보가 없어요"}
          </Text>
        </VStack>
        <HStack gap="x2" wrap="wrap">
          <ActionButton
            variant="neutralSolid"
            size="medium"
            loading={busy}
            disabled={busy || chosen.length === 0}
            onClick={() => void confirm(chosen)}
          >
            고른 {chosen.length}개 확정
          </ActionButton>
          <ActionButton
            variant="neutralWeak"
            size="medium"
            disabled={busy || keys.length === 0}
            onClick={() => void confirm()}
          >
            전부 확정
          </ActionButton>
        </HStack>
      </div>

      {message ? (
        <Callout tone={message.error ? "critical" : "positive"} description={message.text} />
      ) : null}
      {pending.error ? <Callout tone="critical" description={pending.error} /> : null}

      {pending.data === undefined && !pending.error ? (
        <HStack gap="x2" justify="center" py="x8">
          <ProgressCircle aria-label="불러오는 중" />
          <Text color="fg.neutralMuted">불러오는 중</Text>
        </HStack>
      ) : null}

      {pending.data && keys.length === 0 ? (
        <div className="baselines-card">
          <ResultSection
            size="medium"
            title="확정할 후보가 없어요"
            description={"점검을 한 번 돌리면 기기별 후보가 생겨요.\n후보를 확인하고 기준 화면으로 확정해 주세요."}
          />
        </div>
      ) : null}

      {[...groupByDevice(keys)].map(([device, deviceKeys]) => (
        <section key={device} className="baselines-card" aria-label={`${device} 기준 후보`}>
          <HStack gap="x2" align="center">
            <Text as="h3" textStyle="t4Bold">
              {device}
            </Text>
            <Badge tone="informative" variant="weak">
              {`${deviceKeys.length}개`}
            </Badge>
          </HStack>
          <div className="baselines-grid">
            {deviceKeys.map((key) => {
              const { scenario } = splitKey(key);
              const checked = chosen.includes(key);
              return (
                <div key={key} className="baselines-candidate" data-checked={checked || undefined}>
                  {/* 이미지는 마우스 편의용 토글. 키보드·스크린 리더는 아래 체크박스를 쓴다. */}
                  <img
                    src={candidateImageUrl(key)}
                    alt={`${scenario} 후보 화면`}
                    className="baselines-shot"
                    onClick={() => toggle(key)}
                  />
                  <Checkbox
                    label={scenario}
                    size="medium"
                    checked={checked}
                    onCheckedChange={() => toggle(key)}
                  />
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </VStack>
  );
}

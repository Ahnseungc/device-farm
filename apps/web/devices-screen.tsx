import { useState, type FormEvent } from "react";
import { Text, VStack } from "@seed-design/react";

import type { BuildKind, DeviceRun, DeviceState } from "@device-farm/core/device/types";

import { api, errorMessage, usePoll, type DeviceWithState } from "./api-client";
import { LiveView } from "./live-view";
import { ActionButton } from "./seed-design/ui/action-button";
import { Badge, type BadgeProps } from "./seed-design/ui/badge";
import { Callout } from "./seed-design/ui/callout";
import { Checkbox, CheckboxGroup } from "./seed-design/ui/checkbox";
import { ResultSection } from "./seed-design/ui/result-section";
import { SegmentedControl, SegmentedControlItem } from "./seed-design/ui/segmented-control";
import { TextField, TextFieldInput } from "./seed-design/ui/text-field";
import "./devices.css";

export const deviceStateLabel = {
  idle: "대기",
  checking: "점검 중",
  controlling: "조작 중",
  offline: "연결 끊김",
} as const satisfies Record<DeviceState, string>;

const deviceStateTone = {
  idle: "neutral",
  checking: "informative",
  controlling: "warning",
  offline: "critical",
} as const satisfies Record<DeviceState, BadgeProps["tone"]>;

const buildKinds = ["dev", "prod"] as const satisfies readonly BuildKind[];

export function StateChip({ state }: { state: DeviceState }) {
  return (
    <Badge tone={deviceStateTone[state]} variant="weak" size="medium">
      {deviceStateLabel[state]}
    </Badge>
  );
}

/** 지금 도는 실행에서 이 기기가 어느 화면까지 왔는지. */
function currentStep(run: DeviceRun | null | undefined, deviceId: string): string | null {
  if (!run || run.finishedAt) return null;
  const outcome = run.outcomes.find((item) => item.device.id === deviceId);
  if (!outcome || outcome.status !== "running") return null;
  const last = outcome.screens.at(-1);
  return last ? `${last.scenario} 확인 중` : "준비 중";
}

interface DevicesScreenProps {
  onOpen: (deviceId: string) => void;
}

export function DevicesScreen({ onOpen }: DevicesScreenProps) {
  const devices = usePoll(api.devices);
  const latest = usePoll(api.latestRun);
  const list = devices.data ?? [];

  return (
    <VStack className="devices-page" gap="x5">
      <RunForm devices={list} onStarted={() => void latest.reload()} />
      {devices.error ? <Callout tone="critical" description={devices.error} /> : null}
      {devices.data && list.length === 0 ? (
        <div className="devices-card">
          <ResultSection
            size="medium"
            title="연결된 기기가 없어요"
            description={"USB로 기기를 연결하면\n여기에 바로 나타나요."}
          />
        </div>
      ) : null}
      {list.length > 0 ? (
        <div className="devices-grid">
          {list.map((device) => (
            <DeviceCard key={device.id} device={device} step={currentStep(latest.data, device.id)} onOpen={onOpen} />
          ))}
        </div>
      ) : null}
    </VStack>
  );
}

interface DeviceCardProps {
  device: DeviceWithState;
  step: string | null;
  onOpen: (deviceId: string) => void;
}

function DeviceCard({ device, step, onOpen }: DeviceCardProps) {
  return (
    <article className="devices-card devices-device" aria-label={device.model}>
      <div className="devices-thumb">
        {device.state === "offline" ? (
          <div className="devices-media-empty">
            <Text textStyle="t3Medium" color="fg.neutralSubtle">
              화면 없음
            </Text>
          </div>
        ) : (
          <LiveView device={device} width="100%" />
        )}
      </div>
      <VStack gap="x2" grow minWidth="0" align="flex-start">
        <StateChip state={device.state} />
        <VStack gap="x1">
          <Text as="h3" textStyle="t5Bold" color="fg.neutral">
            {device.model}
          </Text>
          <Text as="p" textStyle="t4Regular" color="fg.neutralMuted">
            {device.platform === "ios" ? "iOS" : "Android"} {device.osVersion}
          </Text>
          <Text as="p" textStyle="t3Regular" color="fg.neutralSubtle">
            설치 버전 {device.appVersion ?? "없음"}
          </Text>
        </VStack>
        {step ? (
          <Text as="p" textStyle="t3Medium" color="fg.informative">
            {step}
          </Text>
        ) : null}
        <div className="devices-card-action">
          <ActionButton variant="neutralWeak" size="small" onClick={() => onOpen(device.id)}>
            크게 보기
          </ActionButton>
        </div>
      </VStack>
    </article>
  );
}

interface RunFormProps {
  devices: DeviceWithState[];
  onStarted: () => void;
}

function RunForm({ devices, onStarted }: RunFormProps) {
  const [kind, setKind] = useState<BuildKind>("dev");
  const [version, setVersion] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [pending, setPending] = useState(false);
  const [buttonCheck, setButtonCheck] = useState(false);

  const toggle = (id: string) =>
    setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!version.trim()) {
      setMessage({ text: "버전을 입력해 주세요.", error: true });
      return;
    }
    setPending(true);
    try {
      const { runId } = await api.startRun({
        kind,
        version: version.trim(),
        devices: selected.length > 0 ? selected : "all",
        buttonCheck,
      });
      setMessage({ text: `점검을 시작했습니다. (${runId})`, error: false });
      onStarted();
    } catch (error) {
      setMessage({ text: errorMessage(error), error: true });
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="devices-card devices-form" onSubmit={(event) => void submit(event)} aria-label="점검 실행">
      <Text as="h2" textStyle="t6Bold" color="fg.neutral">
        점검 실행
      </Text>
      <div className="devices-form-row">
        <VStack gap="x2">
          <Text id="devices-build-label" textStyle="t5Medium" color="fg.neutral">
            빌드
          </Text>
          <SegmentedControl
            aria-labelledby="devices-build-label"
            value={kind}
            onValueChange={(value) => setKind(value === "prod" ? "prod" : "dev")}
          >
            {buildKinds.map((item) => (
              <SegmentedControlItem key={item} value={item}>
                {item}
              </SegmentedControlItem>
            ))}
          </SegmentedControl>
        </VStack>
        <div className="devices-version">
          <TextField label="버전" value={version} onValueChange={({ value }) => setVersion(value)}>
            <TextFieldInput placeholder="1.8.0" />
          </TextField>
        </div>
      </div>
      {devices.length > 0 ? (
        <CheckboxGroup label="기기" indicator="고르지 않으면 전체">
          {devices.map((device) => (
            <Checkbox
              key={device.id}
              label={`${device.model} · ${device.osVersion}`}
              checked={selected.includes(device.id)}
              onCheckedChange={() => toggle(device.id)}
            />
          ))}
        </CheckboxGroup>
      ) : null}
      <VStack gap="x1">
        <Checkbox label="버튼 눌러보기" checked={buttonCheck} onCheckedChange={() => setButtonCheck((current) => !current)} />
        <Text textStyle="t3Regular" color="fg.neutralSubtle">
          화면마다 버튼·링크를 최대 12개 눌러 반응·에러를 보고, 어디로 가는지 화면 지도에 모아요. 쓰기 요청은 막아요. 점검 시간이 길어져요.
        </Text>
      </VStack>
      <div className="devices-card-action">
        <ActionButton type="submit" variant="neutralSolid" size="medium" loading={pending} disabled={pending}>
          점검 실행
        </ActionButton>
      </div>
      {message ? (
        <Callout tone={message.error ? "critical" : "informative"} description={message.text} />
      ) : null}
    </form>
  );
}

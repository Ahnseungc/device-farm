import { useState, type FormEvent } from "react";
import { HStack, Text, VStack } from "@seed-design/react";

import type { BuildKind, DeviceRun, DeviceState } from "@device-farm/core/device/types";

import { FloatingNotice, type Notice } from "./floating-notice";
import { LoadingState } from "./loading-state";
import { api, errorMessage, usePoll, type DeviceWithState } from "./api-client";
import { plural, t } from "./i18n";
import { LiveView } from "./live-view";
import { ActionButton } from "./seed-design/ui/action-button";
import { Badge, type BadgeProps } from "./seed-design/ui/badge";
import { Callout } from "./seed-design/ui/callout";
import { Checkbox, CheckboxGroup } from "./seed-design/ui/checkbox";
import { DialogContent, DialogRoot } from "./seed-design/ui/dialog";
import { ResultSection } from "./seed-design/ui/result-section";
import { SegmentedControl, SegmentedControlItem } from "./seed-design/ui/segmented-control";
import { TextField, TextFieldInput } from "./seed-design/ui/text-field";
import "./devices.css";

export const deviceStateLabel = (state: DeviceState): string =>
  ({
    idle: t("대기", "Idle"),
    checking: t("점검 중", "Checking"),
    controlling: t("조작 중", "In control"),
    offline: t("연결 끊김", "Offline"),
  })[state];

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
      {deviceStateLabel(state)}
    </Badge>
  );
}

/** 지금 도는 실행에서 이 기기가 어느 화면까지 왔는지. */
function currentStep(run: DeviceRun | null | undefined, deviceId: string): string | null {
  if (!run || run.finishedAt) return null;
  const outcome = run.outcomes.find((item) => item.device.id === deviceId);
  if (!outcome || outcome.status !== "running") return null;
  const last = outcome.screens.at(-1);
  return last ? t(`${last.scenario} 확인 중`, `Checking ${last.scenario}`) : t("준비 중", "Preparing");
}

interface DevicesScreenProps {
  onOpen: (deviceId: string) => void;
}

export function DevicesScreen({ onOpen }: DevicesScreenProps) {
  const devices = usePoll(api.devices);
  const latest = usePoll(api.latestRun);
  const [runOpen, setRunOpen] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  if (devices.data === undefined) return devices.error ? <Callout tone="critical" description={devices.error} /> : <LoadingState />;
  const list = devices.data;
  const busy = list.filter((device) => device.state === "checking").length;

  return (
    <VStack className="devices-page" gap="x5">
      <FloatingNotice notice={notice} onClose={() => setNotice(null)} />
      <HStack justify="space-between" align="flex-end" gap="x3" wrap="wrap">
        <VStack gap="x1">
          <Text as="h1" textStyle="t7Bold">
            {t(`기기 ${list.length}대`, plural(list.length, "device"))}
          </Text>
          <Text textStyle="t4Regular" color="fg.neutralMuted">
            {list.length === 0
              ? t("USB로 기기를 연결하면 바로 나타나요.", "Connect a device over USB and it shows up right away.")
              : busy > 0
                ? t(`${busy}대가 점검 중이에요. 기기를 누르면 크게 보고 직접 조작할 수 있어요.`, `${busy} checking. Click a device to view it large and control it.`)
                : t("기기를 누르면 크게 보고 직접 조작할 수 있어요.", "Click a device to view it large and control it.")}
          </Text>
        </VStack>
        <ActionButton variant="brandSolid" size="medium" disabled={list.length === 0} onClick={() => setRunOpen(true)}>
          {t("새 빌드 점검", "Check a new build")}
        </ActionButton>
      </HStack>
      {devices.error ? <Callout tone="critical" description={devices.error} /> : null}
      {list.length === 0 ? (
        <div className="devices-card">
          <ResultSection
            size="medium"
            title={t("연결된 기기가 없어요", "No devices connected")}
            description={t("USB로 기기를 연결하고 USB 디버깅을 허용하면\n여기에 바로 나타나요.", "Connect a device over USB and allow USB debugging\nand it shows up here.")}
          />
        </div>
      ) : (
        <div className="devices-grid">
          {list.map((device) => (
            <DeviceCard key={device.id} device={device} step={currentStep(latest.data, device.id)} onOpen={onOpen} />
          ))}
        </div>
      )}
      <DialogRoot open={runOpen} onOpenChange={(open) => !open && setRunOpen(false)}>
        <DialogContent
          title={t("새 빌드 점검", "Check a new build")}
          description={t("빌드를 설치하고 화면·플로우·데이터·정책 점검을 전부 돌려요.", "Installs the build and runs every screen, flow, data and policy check.")}
        >
          <RunForm
            devices={list}
            onStarted={(text) => {
              setRunOpen(false);
              setNotice({ text, error: false });
              void latest.reload();
            }}
          />
        </DialogContent>
      </DialogRoot>
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
    <button type="button" className="devices-card devices-device" aria-label={t(`${device.model} 크게 보기`, `Open ${device.model}`)} onClick={() => onOpen(device.id)}>
      <div className="devices-thumb">
        {device.state === "offline" ? (
          <div className="devices-media-empty">
            <Text textStyle="t3Medium" color="fg.neutralSubtle">
              {t("화면 없음", "No screen")}
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
            {t("앱", "App")} {device.appVersion ?? t("없음", "none")}
          </Text>
        </VStack>
        {/* 진행 줄은 비어 있어도 자리를 둔다 — 점검이 시작·끝날 때 카드가 들썩이지 않게 */}
        <Text as="p" textStyle="t3Medium" color="fg.informative" className="devices-card-step" aria-hidden={step ? undefined : true}>
          {step ?? " "}
        </Text>
        <Text textStyle="t3Medium" color="fg.neutralMuted" className="devices-card-more">
          {t("크게 보기", "Open")}
        </Text>
      </VStack>
    </button>
  );
}

interface RunFormProps {
  devices: DeviceWithState[];
  onStarted: (text: string) => void;
}

function RunForm({ devices, onStarted }: RunFormProps) {
  const [kind, setKind] = useState<BuildKind>("dev");
  const [version, setVersion] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [buttonCheck, setButtonCheck] = useState(false);

  const toggle = (id: string) =>
    setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!version.trim()) {
      setError(t("설치할 버전을 적어 주세요.", "Enter the version to install."));
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
      onStarted(
        t(
          `${kind} ${version.trim()} 점검을 시작했어요. 오른쪽에서 진행을 볼 수 있어요. (${runId})`,
          `Started checking ${kind} ${version.trim()}. Progress shows on the right. (${runId})`,
        ),
      );
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="devices-form" onSubmit={(event) => void submit(event)} aria-label={t("새 빌드 점검", "Check a new build")}>
      <div className="devices-form-row">
        <VStack gap="x2">
          <Text id="devices-build-label" textStyle="t5Medium" color="fg.neutral">
            {t("빌드", "Build")}
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
          <TextField label={t("버전", "Version")} value={version} onValueChange={({ value }) => setVersion(value)}>
            <TextFieldInput placeholder="1.8.0" autoFocus />
          </TextField>
        </div>
      </div>
      {devices.length > 0 ? (
        <CheckboxGroup label={t("기기", "Devices")} indicator={t("고르지 않으면 전체", "All if none selected")}>
          {devices.map((device) => (
            <Checkbox
              key={device.id}
              label={`${device.model} ${device.osVersion}`}
              checked={selected.includes(device.id)}
              onCheckedChange={() => toggle(device.id)}
            />
          ))}
        </CheckboxGroup>
      ) : null}
      <VStack gap="x1">
        <Checkbox label={t("버튼도 눌러 보기", "Also press buttons")} checked={buttonCheck} onCheckedChange={() => setButtonCheck((current) => !current)} />
        <Text textStyle="t3Regular" color="fg.neutralSubtle">
          {t(
            "화면마다 버튼을 12개까지 눌러 보고 화면 지도를 채워요. 플로우 만들 때 고를 버튼이 늘어나요. 시간이 더 걸려요.",
            "Presses up to 12 buttons per screen and fills in the screen map, so you get more buttons to pick from when building flows. Takes longer.",
          )}
        </Text>
      </VStack>
      {error ? (
        <Text textStyle="t3Regular" color="fg.critical">
          {error}
        </Text>
      ) : null}
      <ActionButton type="submit" variant="brandSolid" size="large" loading={pending} disabled={pending}>
        {t("점검 시작", "Start check")}
      </ActionButton>
    </form>
  );
}

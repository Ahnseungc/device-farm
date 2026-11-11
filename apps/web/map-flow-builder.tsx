import { useState } from "react";
import { IconArrowRightLine } from "@karrotmarket/react-monochrome-icon";
import { HStack, Text, VStack } from "@seed-design/react";

import { advance, blocksAt, mapFlowError, startCursorOf, type MapBlock, type MapCursor, type MapRules } from "@device-farm/core/flows/map-flow";
import { stepTarget, type FlowStep } from "@device-farm/core/flows/schema";

import { api, errorMessage, usePoll } from "./api-client";
import { useAppConfig } from "./app-context";
import { getLocale, t } from "./i18n";
import { ActionButton } from "./seed-design/ui/action-button";
import { Badge, type BadgeProps } from "./seed-design/ui/badge";
import { Callout } from "./seed-design/ui/callout";
import { TextField, TextFieldInput } from "./seed-design/ui/text-field";
import "./map-flow-builder.css";

type Message = { text: string; error: boolean };
type StepKind = MapBlock["kind"] | "home" | "expectText";

const kindLabel = (kind: StepKind): string =>
  ({ tab: t("탭", "Tab"), navigate: t("이동", "Navigate"), popup: t("팝업", "Popup"), home: t("홈", "Home"), expectText: t("문구 확인", "Expect text") })[kind];

/** core `advance`·`mapFlowError`의 한국어 문장을 영어 화면에서 바꿔 보인다 */
const mapFlowMessagePatterns: [RegExp, (...groups: string[]) => string][] = [
  [/^(\d+)번째 블록: (.*)$/s, (index, rest) => `Block ${index}: ${localizeMapFlowMessage(rest)}`],
  [/^「(.*)」는 앞 블록을 누른 뒤 지도에 남은 문구가 아닙니다\.$/s, (text) => `“${text}” is not text the map recorded after the previous block.`],
  [/^「(.*)」는 (.*) 화면 지도에 없는 버튼입니다\.$/s, (name, path) => `“${name}” is not a button on ${path} in the screen map.`],
  [/^누르는 블록이 없습니다\.$/, () => "Add at least one tap block."],
  [/^문구 확인 블록이 없습니다\.$/, () => "Add at least one expect-text block."],
];

function localizeMapFlowMessage(message: string): string {
  if (getLocale() !== "en") return message;
  for (const [pattern, english] of mapFlowMessagePatterns) {
    const match = pattern.exec(message);
    if (match) return english(...match.slice(1));
  }
  return message;
}
const kindTones = { tab: "neutral", navigate: "informative", popup: "warning", home: "neutral", expectText: "positive" } as const satisfies Record<StepKind, BadgeProps["tone"]>;

/** 조립한 스텝 한 줄: 종류, 누른 버튼·확인 문구, 누른 뒤 도착한 화면 */
interface PlacedStep {
  kind: StepKind;
  label: string;
  path: string;
}

/** 스텝을 지도 위에서 차례로 밟아 줄마다 종류·도착 화면을 붙인다. 지도와 어긋나면 그 자리에서 멈춘다. */
function placeSteps(edges: Parameters<typeof blocksAt>[0], steps: readonly FlowStep[], rules: MapRules): { placed: PlacedStep[]; cursor: MapCursor | string } {
  const placed: PlacedStep[] = [];
  let cursor: MapCursor = startCursorOf(rules);
  for (const [index, step] of steps.entries()) {
    const kind: StepKind =
      step.type === "click"
        ? (blocksAt(edges, cursor.path, rules).find((block) => block.step.target.name === step.target.name && block.step.target.role === step.target.role)?.kind ?? "navigate")
        : step.type;
    const next = advance(edges, cursor, step, rules);
    if (typeof next === "string") return { placed, cursor: localizeMapFlowMessage(`${index + 1}번째 블록: ${next}`) };
    cursor = next;
    placed.push({ kind, label: stepTarget(step, rules.homeTabName), path: cursor.path });
  }
  return { placed, cursor };
}

function KindBadge({ kind }: { kind: StepKind }) {
  return (
    <Badge tone={kindTones[kind]} variant="weak">
      {kindLabel(kind)}
    </Badge>
  );
}

/** 왼쪽: 홈부터 지금까지 붙인 블록. 화면이 바뀐 줄에는 도착 화면을 적는다. */
function StepTimeline({ placed, onRemoveLast, onClear }: { placed: PlacedStep[]; onRemoveLast: () => void; onClear: () => void }) {
  const { homePath } = useAppConfig();
  return (
    <VStack gap="x3" className="mfb-column">
      <HStack justify="space-between" align="center">
        <Text textStyle="t4Bold">{t(`조립한 플로우 · ${placed.length}개`, `Assembled flow · ${placed.length} blocks`)}</Text>
        <HStack gap="x1_5">
          <ActionButton variant="neutralWeak" size="small" disabled={placed.length === 0} onClick={onRemoveLast}>
            {t("마지막 빼기", "Remove last")}
          </ActionButton>
          <ActionButton variant="neutralWeak" size="small" disabled={placed.length === 0} onClick={onClear}>
            {t("처음부터", "Start over")}
          </ActionButton>
        </HStack>
      </HStack>
      <ol className="mfb-timeline">
        <li className="mfb-step">
          <span className="mfb-step-index">0</span>
          <VStack gap="x0_5" className="mfb-step-body">
            <HStack gap="x1_5" align="center">
              <KindBadge kind="home" />
              <Text textStyle="t4Medium">{t("홈에서 시작", "Start at home")}</Text>
            </HStack>
            <Text textStyle="t3Regular" color="fg.neutralSubtle">{homePath}</Text>
          </VStack>
        </li>
        {placed.map((step, index) => {
          const moved = step.path !== (index === 0 ? homePath : placed[index - 1].path);
          return (
            <li key={index} className="mfb-step">
              <span className="mfb-step-index">{index + 1}</span>
              <VStack gap="x0_5" className="mfb-step-body">
                <HStack gap="x1_5" align="center">
                  <KindBadge kind={step.kind} />
                  <Text textStyle="t4Medium">{step.label}</Text>
                </HStack>
                {moved ? <Text textStyle="t3Regular" color="fg.neutralSubtle">{`→ ${step.path}`}</Text> : null}
              </VStack>
            </li>
          );
        })}
      </ol>
    </VStack>
  );
}

/** 오른쪽 블록 한 줄: 종류 배지, 버튼 이름, 이동이면 도착 화면 */
function BlockRow({ kind, label, to, onPick }: { kind: StepKind; label: string; to?: string; onPick: () => void }) {
  return (
    <button type="button" className="mfb-block" onClick={onPick}>
      <KindBadge kind={kind} />
      <Text textStyle="t4Medium" className="mfb-block-label">{label}</Text>
      {to ? (
        <span className="mfb-block-to">
          <IconArrowRightLine aria-hidden="true" width={14} height={14} />
          <Text textStyle="t3Regular" color="fg.neutralSubtle">{to}</Text>
        </span>
      ) : null}
    </button>
  );
}

function BlockGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <VStack gap="x1_5">
      <Text textStyle="t3Bold" color="fg.neutralMuted">{title}</Text>
      <div className="mfb-blocks">{children}</div>
    </VStack>
  );
}

/** 오른쪽: 지금 화면에서 붙일 수 있는 블록. 문구 확인 → 이 화면 버튼 → 탭·홈 순서. */
function BlockPalette({ edges, cursor, canGoHome, onPick }: { edges: Parameters<typeof blocksAt>[0]; cursor: MapCursor; canGoHome: boolean; onPick: (step: FlowStep) => void }) {
  const blocks = blocksAt(edges, cursor.path, useAppConfig());
  const own = blocks.filter((block) => block.kind !== "tab");
  const tabs = blocks.filter((block) => block.kind === "tab");
  return (
    <VStack gap="x4" className="mfb-column">
      <VStack gap="x0_5">
        <Text textStyle="t3Regular" color="fg.neutralSubtle">{t("지금 화면", "Current screen")}</Text>
        <Text textStyle="t5Bold">{cursor.path}</Text>
      </VStack>
      {cursor.texts.length > 0 ? (
        <BlockGroup title={t("방금 누른 뒤 보인 문구", "Text shown after the last tap")}>
          {cursor.texts.map((text) => (
            <BlockRow key={text} kind="expectText" label={text} onPick={() => onPick({ type: "expectText", text })} />
          ))}
        </BlockGroup>
      ) : null}
      <BlockGroup title={t("이 화면 버튼", "Buttons on this screen")}>
        {own.length > 0 ? (
          own.map((block) => (
            <BlockRow
              key={`${block.step.target.role}:${block.step.target.name}`}
              kind={block.kind}
              label={block.step.target.name}
              to={block.kind === "navigate" ? block.to : undefined}
              onPick={() => onPick(block.step)}
            />
          ))
        ) : (
          <Text textStyle="t3Regular" color="fg.neutralMuted">{t("이 화면은 아직 버튼 눌러보기 기록이 없어요. 탭이나 홈으로 옮겨 가세요.", "No button crawl data for this screen yet. Move to a tab or back home.")}</Text>
        )}
      </BlockGroup>
      <VStack gap="x1_5">
        <Text textStyle="t3Bold" color="fg.neutralMuted">{t("하단 탭 · 홈", "Bottom tabs · Home")}</Text>
        <HStack gap="x1_5" wrap="wrap">
          {tabs.map((block) => (
            <ActionButton key={block.step.target.name} variant="neutralWeak" size="small" onClick={() => onPick(block.step)}>
              {block.step.target.name}
            </ActionButton>
          ))}
          {canGoHome ? (
            <ActionButton variant="neutralOutline" size="small" onClick={() => onPick({ type: "home" })}>
              {t("홈으로 돌아가기", "Back to home")}
            </ActionButton>
          ) : null}
        </HStack>
      </VStack>
    </VStack>
  );
}

/** 화면 지도로 플로우 조립: 홈에서 시작해 지금 화면에서 누를 수 있는 블록을 하나씩 이어 붙인다. */
export function MapFlowBuilder({ onAdded }: { onAdded: (message: Message) => void }) {
  const rules = useAppConfig();
  const map = usePoll(api.screenMap);
  const [steps, setSteps] = useState<FlowStep[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const edges = map.data?.edges ?? [];
  const { placed, cursor } = placeSteps(edges, steps, rules);
  const rawInvalid = mapFlowError(edges, steps, rules);
  const invalid = rawInvalid === null ? null : localizeMapFlowMessage(rawInvalid);

  async function save() {
    setBusy(true);
    try {
      await api.addMapFlow({ name: name.trim(), steps });
      onAdded({ text: t(`「${name.trim()}」을 후보에 담았습니다. 후보에서 확정하면 다음 점검부터 돌아요.`, `Added “${name.trim()}” to the candidates. Confirm it there and it runs from the next check.`), error: false });
      setSteps([]);
      setName("");
    } catch (error) {
      onAdded({ text: errorMessage(error), error: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="baselines-card" aria-label={t("화면 지도로 플로우 만들기", "Build a flow from the screen map")}>
      <VStack gap="x0_5">
        <Text as="h2" textStyle="t5Bold">
          {t("화면 지도로 플로우 만들기", "Build a flow from the screen map")}
        </Text>
        <Text textStyle="t3Regular" color="fg.neutralSubtle">
          {t(
            "오른쪽에서 블록을 고르면 왼쪽에 차례로 붙어요. 버튼을 누른 뒤에는 보인 문구로 확인 블록을 붙일 수 있어요.",
            "Pick blocks on the right and they line up on the left. After a tap, you can add a check block from the text that appeared.",
          )}
        </Text>
      </VStack>
      {map.error ? <Callout tone="critical" description={map.error} /> : null}

      <div className="mfb-layout">
        <StepTimeline placed={placed} onRemoveLast={() => setSteps((current) => current.slice(0, -1))} onClear={() => setSteps([])} />
        {typeof cursor === "string" ? (
          <Callout tone="warning" description={`${t("화면 지도가 바뀌어 이어 붙일 수 없어요.", "The screen map changed, so blocks can no longer be appended.")} ${cursor}`} />
        ) : (
          <BlockPalette edges={edges} cursor={cursor} canGoHome={steps.length > 0} onPick={(step) => setSteps((current) => [...current, step])} />
        )}
      </div>

      <div className="mfb-save">
        <div className="flows-prd">
          <TextField label={t("플로우 이름", "Flow name")} value={name} onValueChange={({ value }) => setName(value)}>
            <TextFieldInput placeholder={t("혜택에서 출석체크 열기", "Open check-in from Rewards")} />
          </TextField>
        </div>
        <ActionButton variant="neutralSolid" size="medium" loading={busy} disabled={busy || invalid !== null || !name.trim()} onClick={() => void save()}>
          {t("후보로 담기", "Add as candidate")}
        </ActionButton>
      </div>
      {steps.length > 0 && invalid ? <Text textStyle="t3Regular" color="fg.neutralMuted">{invalid}</Text> : null}
    </section>
  );
}

import { useState, type FormEvent } from "react";
import { Text, VStack } from "@seed-design/react";
import { IconChevronRightLine } from "@karrotmarket/react-monochrome-icon";

import { advance, blocksAt, mapFlowError, startCursorOf, type MapBlock, type MapCursor, type MapRules } from "@device-farm/core/flows/map-flow";
import { stepTarget, type FlowStep } from "@device-farm/core/flows/schema";

import { api, errorMessage, usePoll } from "./api-client";
import { useAppConfig } from "./app-context";
import { getLocale, t } from "./i18n";
import { StaggeredEntrance, StaggeredEntranceItem } from "./motion/StaggeredEntrance";
import { ActionButton } from "./seed-design/ui/action-button";
import { Callout } from "./seed-design/ui/callout";
import { TextField, TextFieldInput } from "./seed-design/ui/text-field";
import "./map-flow-builder.css";

type Edges = Parameters<typeof blocksAt>[0];

/** core `advance`·`mapFlowError`의 한국어 문장을 영어 화면에서 바꿔 보인다 */
const mapFlowMessagePatterns: [RegExp, (...groups: string[]) => string][] = [
  [/^(\d+)번째 (?:블록|단계): (.*)$/s, (index, rest) => `Step ${index}: ${localizeMapFlowMessage(rest)}`],
  [/^「(.*)」는 앞 블록을 누른 뒤 지도에 남은 문구가 아닙니다\.$/s, (text) => `“${text}” is not text the map recorded after the previous step.`],
  [/^「(.*)」는 (.*) 화면 지도에 없는 버튼입니다\.$/s, (name, path) => `“${name}” is not a button on ${path} in the screen map.`],
  [
    /^팝업이 떠 있어 (.*) 화면 버튼 「(.*)」를 누를 수 없습니다\. 홈으로 돌아간 뒤 이어 주세요\.$/s,
    (path, name) => `A popup is open, so “${name}” on ${path} cannot be tapped. Go back home and continue.`,
  ],
  [/^누르는 블록이 없습니다\.$/, () => "Add at least one tap step."],
  [/^문구 확인 블록이 없습니다\.$/, () => "Add at least one expect-text step."],
];

function localizeMapFlowMessage(message: string): string {
  if (getLocale() !== "en") return message;
  for (const [pattern, english] of mapFlowMessagePatterns) {
    const match = pattern.exec(message);
    if (match) return english(...match.slice(1));
  }
  return message;
}

/** 하단 탭 경로 → 사람이 아는 이름(「홈」) */
export function screenNameOf(tabPaths: Record<string, string>, path: string): string {
  return Object.entries(tabPaths).find(([, tabPath]) => tabPath === path)?.[0] ?? path;
}

/** 만든 흐름의 한 줄: 무엇을 했고, 그 뒤 어느 화면에 있는지 */
interface PlacedStep {
  step: FlowStep;
  /** 사람이 읽는 한 줄(「알림」 누르기, 「모두 읽음」 보이는지 확인) */
  text: string;
  path: string;
}

const describe = (step: FlowStep): string => {
  if (step.type === "click") return t(`「${step.target.name}」 누르기`, `Tap “${step.target.name}”`);
  if (step.type === "expectText") return t(`「${step.text}」 보이는지 확인`, `Check “${step.text}” is shown`);
  if (step.type === "fill") return t(`「${step.label}」에 ${step.value} 입력`, `Type ${step.value} into “${step.label}”`);
  if (step.type === "design") return t("이 화면 디자인 확인", "Check this screen's design");
  if (step.type === "relaunch") return t("앱 다시 켜기", "Relaunch the app");
  if (step.type === "watchAd") return t(`「${step.target.name}」 눌러 광고 보고 잔액이 느는지 확인`, `Tap “${step.target.name}”, watch the ad, and check the balance goes up`);
  return t("홈으로 돌아가기", "Back to home");
};

/** 스텝을 지도 위에서 차례로 밟는다. 지도와 어긋나면 그 자리에서 멈추고 이유를 준다 */
function placeSteps(edges: Edges, steps: readonly FlowStep[], rules: MapRules): { placed: PlacedStep[]; cursor: MapCursor | string } {
  const placed: PlacedStep[] = [];
  let cursor: MapCursor = startCursorOf(rules);
  for (const [index, step] of steps.entries()) {
    const next = advance(edges, cursor, step, rules);
    if (typeof next === "string") return { placed, cursor: localizeMapFlowMessage(`${index + 1}번째 단계: ${next}`) };
    cursor = next;
    placed.push({ step, text: describe(step), path: cursor.path });
  }
  return { placed, cursor };
}

/** 왼쪽: 지금까지 만든 흐름. 홈에서 시작해 한 줄씩. 마지막 줄만 지울 수 있다 */
function FlowSoFar({ placed, onUndo }: { placed: PlacedStep[]; onUndo: () => void }) {
  const { homePath, tabPaths } = useAppConfig();
  return (
    <section className="fc-sofar" aria-label={t("만든 흐름", "Flow so far")}>
      <Text textStyle="t3Bold" color="fg.neutralMuted">
        {t("만든 흐름", "Flow so far")}
      </Text>
      <ol className="fc-timeline">
        <li className="fc-step fc-step-start">
          <span className="fc-dot" aria-hidden="true" />
          <Text textStyle="t4Medium">{t(`${screenNameOf(tabPaths, homePath)}에서 시작`, `Start at ${screenNameOf(tabPaths, homePath)}`)}</Text>
        </li>
        {placed.map((item, index) => {
          const last = index === placed.length - 1;
          const moved = item.path !== (index === 0 ? homePath : placed[index - 1].path);
          return (
            <li key={index} className={`fc-step${last ? " fc-step-last" : ""}`}>
              <span className="fc-dot" aria-hidden="true" />
              <VStack gap="x0_5" className="fc-step-body">
                <Text textStyle="t4Medium">{item.text}</Text>
                {moved ? (
                  <Text textStyle="t3Regular" color="fg.neutralSubtle">
                    {t(`${screenNameOf(tabPaths, item.path)}(으)로 이동`, `Moves to ${screenNameOf(tabPaths, item.path)}`)}
                  </Text>
                ) : null}
              </VStack>
              {last ? (
                <button type="button" className="fc-undo" onClick={onUndo} aria-label={t(`${item.text} 지우기`, `Remove: ${item.text}`)}>
                  {t("지우기", "Remove")}
                </button>
              ) : null}
            </li>
          );
        })}
      </ol>
      {placed.length === 0 ? (
        <Text textStyle="t3Regular" color="fg.neutralSubtle">
          {t("오른쪽에서 누를 곳을 고르면 여기에 차례로 쌓여요.", "Pick what to tap on the right and the steps stack up here.")}
        </Text>
      ) : null}
    </section>
  );
}

function ChoiceRow({ label, hint, onPick }: { label: string; hint?: string; onPick: () => void }) {
  return (
    <button type="button" className="fc-choice" onClick={onPick}>
      <Text textStyle="t4Medium" className="fc-choice-label">
        {label}
      </Text>
      {hint ? (
        <Text textStyle="t3Regular" color="fg.neutralSubtle" className="fc-choice-hint">
          {hint}
        </Text>
      ) : null}
      <span className="fc-choice-arrow" aria-hidden="true">
        <IconChevronRightLine size="1em" />
      </span>
    </button>
  );
}

/**
 * 지금 화면 입력칸에 값 넣기. 화면 지도는 입력칸을 모르니 이름(aria-label, 없으면 placeholder)을 직접 적는다.
 * 넣으면 칸을 비워 다음 입력을 바로 적게 한다.
 */
function FillForm({ onAdd }: { onAdd: (step: FlowStep) => void }) {
  const [label, setLabel] = useState("");
  const [value, setValue] = useState("");
  const ready = label.trim() !== "" && value !== "";

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready) return;
    onAdd({ type: "fill", label: label.trim(), value });
    setLabel("");
    setValue("");
  }

  return (
    <VStack gap="x2">
      <Text textStyle="t4Bold">{t("입력칸에 값을 넣을까요?", "Type into a field?")}</Text>
      <form className="fc-fill" onSubmit={handleSubmit} aria-label={t("입력 단계 넣기", "Add a typing step")}>
        <TextField label={t("입력칸 이름", "Field name")} value={label} onValueChange={({ value: next }) => setLabel(next)}>
          <TextFieldInput placeholder={t("수량", "Quantity")} />
        </TextField>
        <TextField label={t("넣을 값", "Value")} value={value} onValueChange={({ value: next }) => setValue(next)}>
          <TextFieldInput placeholder="3" />
        </TextField>
        <ActionButton type="submit" variant="neutralWeak" size="large" disabled={!ready}>
          {t("입력 넣기", "Add typing")}
        </ActionButton>
      </form>
      <Text textStyle="t3Regular" color="fg.neutralSubtle">
        {t("입력칸 이름은 aria-label이에요. 없으면 placeholder 문구를 적어 주세요.", "The field name is its aria-label. If it has none, use the placeholder text.")}
      </Text>
    </VStack>
  );
}

/** 오른쪽: 지금 화면에서 할 수 있는 것. 확인할 문구(있으면) → 이 화면 버튼 → 하단 탭 */
function NextChoices({ edges, cursor, canGoHome, onPick }: { edges: Edges; cursor: MapCursor; canGoHome: boolean; onPick: (step: FlowStep) => void }) {
  const rules = useAppConfig();
  const screenName = (path: string) => screenNameOf(rules.tabPaths, path);
  const blocks = blocksAt(edges, cursor.path, rules);
  const tabNames = new Set(blocks.filter((block) => block.kind === "tab").map((block) => block.step.target.name));
  // 하단 탭과 같은 이름 버튼은 아래 탭으로만 보인다
  const own = blocks.filter((block) => block.kind !== "tab" && !tabNames.has(block.step.target.name));
  const tabs = blocks.filter((block) => block.kind === "tab");
  const hintOf = (block: MapBlock) =>
    block.kind === "popup" ? t("팝업이 열려요", "Opens a popup") : block.to !== cursor.path ? t(`${screenName(block.to)}로 가요`, `Goes to ${screenName(block.to)}`) : undefined;
  return (
    <section className="fc-next" aria-label={t("다음에 할 것", "Next step")}>
      <VStack gap="x0_5">
        <Text textStyle="t3Regular" color="fg.neutralSubtle">
          {t("지금 화면", "Current screen")}
        </Text>
        <Text as="h3" textStyle="t6Bold">
          {screenName(cursor.path)}
        </Text>
      </VStack>

      {cursor.texts.length > 0 ? (
        <VStack gap="x2">
          <Text textStyle="t4Bold">{t("화면이 맞게 열렸는지 확인할 문구를 골라요", "Pick text that proves the screen opened correctly")}</Text>
          <div className="fc-texts">
            {cursor.texts.map((text) => (
              <button key={text} type="button" className="fc-text" onClick={() => onPick({ type: "expectText", text })}>
                {text}
              </button>
            ))}
          </div>
        </VStack>
      ) : null}

      {cursor.popup ? (
        <div className="fc-empty">
          <Text textStyle="t4Medium">{t("팝업이 열렸어요", "A popup opened")}</Text>
          <Text textStyle="t3Regular" color="fg.neutralMuted">
            {t(
              "팝업 안 버튼은 아직 지도에 없고, 뒤 화면 버튼은 팝업에 가려 누를 수 없어요. 위에서 확인할 문구를 고르고 저장하거나, 홈으로 돌아가 이어 만들어요.",
              "Buttons inside the popup aren't in the map yet, and the popup covers the screen behind it. Pick text to check above and save, or go back home and keep building.",
            )}
          </Text>
        </div>
      ) : (
        <VStack gap="x2">
          <Text textStyle="t4Bold">{t("어디를 누를까요?", "What should it tap?")}</Text>
          {own.length > 0 ? (
            <StaggeredEntrance className="fc-choices" key={cursor.path}>
              {own.map((block) => (
                <StaggeredEntranceItem key={`${block.step.target.role}:${block.step.target.name}`}>
                  <ChoiceRow label={block.step.target.name} hint={hintOf(block)} onPick={() => onPick(block.step)} />
                </StaggeredEntranceItem>
              ))}
            </StaggeredEntrance>
          ) : (
            <div className="fc-empty">
              <Text textStyle="t4Medium">{t("이 화면은 아직 눌러 본 버튼이 없어요", "No buttons have been tried on this screen yet")}</Text>
              <Text textStyle="t3Regular" color="fg.neutralMuted">
                {t(
                  "점검에서 「버튼 눌러보기」를 켜고 돌리면 이 화면 버튼이 생겨요. 지금은 아래 탭으로 옮겨 갈 수 있어요.",
                  "Run a check with “Button crawl” on and this screen's buttons will appear. For now you can move with the tabs below.",
                )}
              </Text>
            </div>
          )}
        </VStack>
      )}

      {cursor.popup ? null : <FillForm key={cursor.path} onAdd={onPick} />}

      {/* 팝업이 열린 상태도 디자인이 따로 있어 팝업 중에도 넣을 수 있다 */}
      <VStack gap="x2">
        <ActionButton variant="neutralWeak" size="large" onClick={() => onPick({ type: "design" })}>
          {t("이 화면 디자인 확인 넣기", "Add a design check for this screen")}
        </ActionButton>
        <Text textStyle="t3Regular" color="fg.neutralSubtle">
          {t(
            "점검이 이 단계에 오면 화면을 피그마·정책과 맞춰 보고 화면 깨짐을 재요. 달라도 플로우는 이어 가요.",
            "When a check reaches this step, it compares the screen with Figma and the policy rules and measures layout breakage. The flow keeps going even if they differ.",
          )}
        </Text>
      </VStack>

      <div className="fc-tabbar" role="group" aria-label={t("하단 탭", "Bottom tabs")}>
        {(cursor.popup ? [] : tabs).map((block) => (
          <button key={block.step.target.name} type="button" className="fc-tab" aria-current={block.to === cursor.path ? "true" : undefined} onClick={() => onPick(block.step)}>
            {block.step.target.name}
          </button>
        ))}
        {canGoHome ? (
          <button type="button" className="fc-tab" onClick={() => onPick({ type: "home" })}>
            {t("홈으로", "Home")}
          </button>
        ) : null}
      </div>
    </section>
  );
}

/** 저장 버튼이 꺼진 이유를 한 줄로 */
function saveHint(steps: readonly FlowStep[], name: string, invalid: string | null): string | null {
  if (!steps.some((step) => step.type === "click")) return t("누를 곳을 하나 이상 골라 주세요", "Pick at least one thing to tap");
  if (!steps.some((step) => step.type === "expectText")) return t("화면이 맞게 열렸는지 확인할 문구를 하나 골라 주세요", "Pick one text that proves the screen opened correctly");
  if (invalid) return invalid;
  if (!name.trim()) return t("이름을 적어 주세요", "Enter a name");
  return null;
}

/** 이름 자동 제안: 마지막으로 누른 버튼 기준(「홈에서 알림 열기」) */
function suggestName(placed: readonly PlacedStep[], rules: MapRules): string {
  const clicks = placed.filter((item) => item.step.type === "click");
  if (clicks.length === 0) return "";
  const last = clicks[clicks.length - 1];
  const before = clicks.length > 1 ? clicks[clicks.length - 2] : null;
  // 버튼 이름 「알림 페이지로 이동」 → 「알림」
  const short = (label: string) => label.replace(/(\s*페이지)?\s*(으로|로)\s*이동$/, "").trim() || label;
  const from = before ? short(stepTarget(before.step, rules.homeTabName)) : screenNameOf(rules.tabPaths, rules.homePath);
  const to = short(stepTarget(last.step, rules.homeTabName));
  return t(`${from}에서 ${to} 열기`, `Open ${to} from ${from}`);
}

export interface CreatedFlow {
  id: string;
  name: string;
}

/**
 * 새 플로우 만들기: 홈에서 시작해 「어디를 누를까요?」에 하나씩 답하면 흐름이 쌓이고, 이름을 적어 저장한다.
 * 화면 지도(버튼 눌러보기 기록)에 있는 버튼만 고를 수 있어 저장하면 바로 점검에 넣는다.
 */
export function FlowCreator({ onBack, onCreated }: { onBack: () => void; onCreated: (flow: CreatedFlow) => void }) {
  const rules = useAppConfig();
  const map = usePoll(api.screenMap);
  const [steps, setSteps] = useState<FlowStep[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const edges = map.data?.edges ?? [];
  const { placed, cursor } = placeSteps(edges, steps, rules);
  const rawInvalid = steps.length > 0 ? mapFlowError(edges, steps, rules) : null;
  const invalid = rawInvalid === null ? null : localizeMapFlowMessage(rawInvalid);
  const suggested = suggestName(placed, rules);
  const finalName = name.trim() || suggested;
  const hint = saveHint(steps, finalName, invalid);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const { id } = await api.addMapFlow({ name: finalName, steps });
      // 지도에 있는 버튼으로만 만들어 검토 없이 바로 점검에 넣는다
      await api.confirmFlows([id]);
      onCreated({ id, name: finalName });
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <VStack gap="x4" className="fc-page">
      <div>
        <ActionButton variant="ghost" size="small" onClick={onBack}>
          {t("플로우로 돌아가기", "Back to flows")}
        </ActionButton>
      </div>
      <VStack gap="x1">
        <Text as="h1" textStyle="t7Bold">
          {t("새 플로우 만들기", "New flow")}
        </Text>
        <Text textStyle="t4Regular" color="fg.neutralMuted">
          {t(
            "사람이 앱을 쓰듯 누를 곳을 차례로 골라 주세요. 매일 밤 이대로 눌러 보고 화면이 맞게 열리는지 확인해요.",
            "Pick what to tap in order, the way a person uses the app. Every night the farm taps through it and checks each screen opens correctly.",
          )}
        </Text>
      </VStack>
      {map.error ? <Callout tone="critical" description={map.error} /> : null}

      <div className="fc-layout">
        <FlowSoFar placed={placed} onUndo={() => setSteps((current) => current.slice(0, -1))} />
        {typeof cursor === "string" ? (
          <Callout
            tone="warning"
            description={t(`화면 지도가 바뀌어 이어 만들 수 없어요. 마지막 단계를 지워 주세요. (${cursor})`, `The screen map changed, so this flow can't continue. Remove the last step. (${cursor})`)}
          />
        ) : (
          <NextChoices edges={edges} cursor={cursor} canGoHome={steps.length > 0} onPick={(step) => setSteps((current) => [...current, step])} />
        )}
      </div>

      <div className="fc-savebar">
        <div className="fc-savebar-name">
          <TextField label={t("플로우 이름", "Flow name")} value={name} onValueChange={({ value }) => setName(value)}>
            <TextFieldInput placeholder={suggested || t("홈에서 알림 열기", "Open notifications from Home")} />
          </TextField>
        </div>
        <VStack gap="x1" align="flex-end">
          <ActionButton variant="brandSolid" size="large" loading={busy} disabled={busy || hint !== null} onClick={() => void save()}>
            {t("저장하기", "Save")}
          </ActionButton>
          <Text textStyle="t3Regular" color={error ? "fg.critical" : "fg.neutralSubtle"}>
            {error ?? hint ?? t(`${placed.length}단계예요. 저장하면 다음 점검부터 돌아요`, `${placed.length} steps. Once saved, it runs from the next check`)}
          </Text>
        </VStack>
      </div>
    </VStack>
  );
}

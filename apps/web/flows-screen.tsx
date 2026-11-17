import { useMemo, useState } from "react";
import { HStack, Text, VStack } from "@seed-design/react";

import { designFlowIds, stepTarget, type FlowDocument, type FlowStep } from "@device-farm/core/flows/schema";

import { FloatingNotice } from "./floating-notice";
import { api, errorMessage, usePoll } from "./api-client";
import { useAppConfig } from "./app-context";
import { t } from "./i18n";
import { LoadingState } from "./loading-state";
import { FlowCreator, type CreatedFlow } from "./map-flow-builder";
import { StaggeredEntrance, StaggeredEntranceItem } from "./motion/StaggeredEntrance";
import { ScreenMapSection } from "./screen-map-section";
import { ActionButton } from "./seed-design/ui/action-button";
import { Badge } from "./seed-design/ui/badge";
import { Callout } from "./seed-design/ui/callout";
import { TextField, TextFieldInput } from "./seed-design/ui/text-field";
import "./flows.css";

const proposalLabel = (proposal: NonNullable<FlowDocument["proposal"]>): string =>
  ({ create: t("새로", "New"), update: t("수정", "Update"), delete: t("삭제", "Delete"), keep: t("그대로", "Keep") })[proposal];
const prdListId = "flow-prds";

type Message = { text: string; error: boolean };

/** 한 줄 요약: 「홈 › 알림 › 『모두 읽음』 확인」. 홈 시작은 빼고 누른 것·확인한 것만 */
function stepSummary(steps: readonly FlowStep[], homeTabName: string): string {
  return steps
    .map((step) => {
      if (step.type === "click") return stepTarget(step, homeTabName);
      if (step.type === "expectText") return t(`「${step.text}」 확인`, `check “${step.text}”`);
      if (step.type === "fill") return t(`${step.label}에 ${step.value} 입력`, `type ${step.value} into ${step.label}`);
      if (step.type === "design") return t("디자인 확인", "design check");
      return homeTabName;
    })
    .join(" › ");
}

/** 확정 플로우 한 줄: 이름 · 흐름 요약 · 실행 */
function FlowRow({ flow, running, onRun }: { flow: FlowDocument; running: boolean; onRun: () => void }) {
  const { homeTabName } = useAppConfig();
  return (
    <div className="flows-row">
      <VStack gap="x1" className="flows-row-body">
        <Text textStyle="t5Bold">{flow.name}</Text>
        <Text textStyle="t3Regular" color="fg.neutralMuted" className="flows-row-steps">
          {stepSummary(flow.steps, homeTabName)}
        </Text>
      </VStack>
      <ActionButton variant="neutralWeak" size="small" disabled={running} onClick={onRun}>
        {t("실행", "Run")}
      </ActionButton>
    </div>
  );
}

/** 검토할 후보(PRD로 만든 것). 확정해야 점검에 들어간다 */
function ReviewBox({ candidates, busy, onConfirm }: { candidates: FlowDocument[]; busy: boolean; onConfirm: (ids?: string[]) => void }) {
  const { homeTabName } = useAppConfig();
  const confirmable = candidates.filter((flow) => flow.status === "generated" && flow.proposal !== "keep");
  return (
    <section className="flows-review" aria-label={t("검토할 플로우", "Flows to review")}>
      <HStack justify="space-between" align="center" gap="x2" wrap="wrap">
        <VStack gap="x0_5">
          <Text textStyle="t5Bold">{t(`검토할 플로우 ${candidates.length}개`, `${candidates.length} flows to review`)}</Text>
          <Text textStyle="t3Regular" color="fg.neutralMuted">
            {t("PRD로 만든 후보예요. 확정하면 다음 점검부터 돌아요.", "Candidates drafted from a PRD. Confirm them and they run from the next check.")}
          </Text>
        </VStack>
        <ActionButton variant="brandSolid" size="small" loading={busy} disabled={busy || confirmable.length === 0} onClick={() => onConfirm()}>
          {t("모두 확정", "Confirm all")}
        </ActionButton>
      </HStack>
      {candidates.map((flow) => (
        <div key={`${flow.prd}:${flow.id}`} className="flows-row">
          <VStack gap="x1" className="flows-row-body">
            <HStack gap="x1_5" align="center" wrap="wrap">
              <Text textStyle="t4Bold">{flow.name}</Text>
              {flow.proposal ? (
                <Badge tone="informative" variant="weak">
                  {proposalLabel(flow.proposal)}
                </Badge>
              ) : null}
              {flow.status === "generation_failed" ? (
                <Badge tone="critical" variant="weak">
                  {t("만들기 실패", "Generation failed")}
                </Badge>
              ) : null}
            </HStack>
            <Text textStyle="t3Regular" color="fg.neutralMuted" className="flows-row-steps">
              {flow.reason ?? stepSummary(flow.steps, homeTabName)}
            </Text>
          </VStack>
          {confirmable.includes(flow) ? (
            <ActionButton variant="neutralWeak" size="small" disabled={busy} onClick={() => onConfirm([flow.id])}>
              {t("확정", "Confirm")}
            </ActionButton>
          ) : null}
        </div>
      ))}
    </section>
  );
}

/** PRD를 골라 LLM이 후보를 만든다. 키가 없으면 이유만 보인다 */
function GenerateFromPrd({ prds, ready, onDone }: { prds: string[]; ready: boolean; onDone: (message: Message) => void }) {
  const [prd, setPrd] = useState("");
  const [busy, setBusy] = useState(false);

  async function generate() {
    setBusy(true);
    try {
      const result = await api.generateFlows(prd);
      onDone({
        text: result.skipped
          ? `${t("건너뛰었어요", "Skipped")}: ${result.reason ?? ""}`
          : t(`후보 ${result.generated}개를 만들었어요. 위에서 검토해 주세요.`, `Generated ${result.generated} candidate(s). Review them above.`),
        error: false,
      });
    } catch (error) {
      onDone({ text: errorMessage(error), error: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <VStack gap="x2">
      {!ready ? (
        <Text textStyle="t3Regular" color="fg.neutralMuted">
          {t("PRD 경로(FLOW_PRD_ROOT)나 LLM 키(FLOW_LLM_*)가 없어 지금은 쓸 수 없어요.", "Unavailable: the PRD path (FLOW_PRD_ROOT) or the LLM key (FLOW_LLM_*) is not set.")}
        </Text>
      ) : null}
      <HStack gap="x2" align="flex-end" wrap="wrap">
        <div className="flows-prd">
          <TextField label={t("PRD 파일", "PRD file")} value={prd} onValueChange={({ value }) => setPrd(value)} disabled={!ready}>
            <TextFieldInput placeholder="app/(shop)/benefit/_src/specs/README.md" list={prdListId} />
          </TextField>
          <datalist id={prdListId}>
            {prds.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </div>
        <ActionButton variant="neutralWeak" size="medium" loading={busy} disabled={busy || !ready || !prds.includes(prd)} onClick={() => void generate()}>
          {t("후보 만들기", "Generate")}
        </ActionButton>
      </HStack>
    </VStack>
  );
}

/** 저장 뒤 한 번: 만들었어요 + 바로 실행해 보기 */
function CreatedNotice({ flow, running, onRun, onClose }: { flow: CreatedFlow; running: boolean; onRun: () => void; onClose: () => void }) {
  return (
    <section className="flows-created" aria-live="polite">
      <VStack gap="x0_5">
        <Text textStyle="t5Bold">{t(`「${flow.name}」을 만들었어요`, `Created “${flow.name}”`)}</Text>
        <Text textStyle="t3Regular" color="fg.neutralMuted">
          {t("다음 점검부터 같이 돌아요. 지금 한 번 돌려 보면 바로 확인할 수 있어요.", "It runs from the next check. Run it once now to see it right away.")}
        </Text>
      </VStack>
      <HStack gap="x2">
        <ActionButton variant="brandSolid" size="small" loading={running} disabled={running} onClick={onRun}>
          {t("바로 실행해 보기", "Run it now")}
        </ActionButton>
        <ActionButton variant="ghost" size="small" onClick={onClose}>
          {t("닫기", "Close")}
        </ActionButton>
      </HStack>
    </section>
  );
}

/** 「플로우」: 확정 플로우 목록 → 새로 만들기(단계별). PRD 후보·화면 지도는 아래 「더 보기」 */
export function FlowsScreen({ onCreatingChange }: { onCreatingChange?: (creating: boolean) => void }) {
  const { homeTabName } = useAppConfig();
  const state = usePoll(api.flows);
  const [creating, setCreatingState] = useState(false);
  /** 만드는 동안은 진행 중 플로팅이 저장 막대를 가리지 않게 숨긴다 */
  const setCreating = (next: boolean) => {
    setCreatingState(next);
    onCreatingChange?.(next);
  };
  const [created, setCreated] = useState<CreatedFlow | null>(null);
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState<Message | null>(null);
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const ready = state.data?.ready ?? [];
  const designIds = designFlowIds(ready);
  const shown = useMemo(() => {
    const keyword = query.trim();
    return keyword ? ready.filter((flow) => flow.name.includes(keyword) || stepSummary(flow.steps, homeTabName).includes(keyword)) : ready;
  }, [ready, query, homeTabName]);

  async function confirm(ids?: string[]) {
    setBusy(true);
    try {
      const { confirmed } = await api.confirmFlows(ids);
      setMessage({ text: t(`플로우 ${confirmed}개를 확정했어요. 다음 점검부터 돌아요.`, `Confirmed ${confirmed} flow(s). They run from the next check.`), error: false });
      await state.reload();
    } catch (error) {
      setMessage({ text: errorMessage(error), error: true });
    } finally {
      setBusy(false);
    }
  }

  /** ids를 주면 그 플로우만, 없으면 확정 플로우 전부. 설치 없이 지금 깔린 dev 앱으로 */
  async function run(ids?: string[], label = t("플로우 점검", "the flow check")) {
    setRunning(true);
    try {
      await api.startRun({ kind: "dev", devices: "all", flowsOnly: true, ...(ids ? { flowIds: ids } : {}) });
      setMessage({ text: t(`${label}을 시작했어요. 오른쪽에서 진행을 볼 수 있어요.`, `Started ${label}. Watch the progress on the right.`), error: false });
    } catch (error) {
      setMessage({ text: errorMessage(error), error: true });
    } finally {
      setRunning(false);
    }
  }

  if (creating) {
    return (
      <FlowCreator
        onBack={() => setCreating(false)}
        onCreated={(flow) => {
          setCreating(false);
          setCreated(flow);
          void state.reload();
        }}
      />
    );
  }
  if (state.data === undefined) return state.error ? <Callout tone="critical" description={state.error} /> : <LoadingState />;
  const { candidates, prds, prdRootSet, llmConfigured } = state.data;

  return (
    <VStack gap="x5" className="flows-page">
      <HStack justify="space-between" align="flex-end" gap="x3" wrap="wrap">
        <VStack gap="x1">
          <Text as="h1" textStyle="t7Bold">
            {t(`플로우 ${ready.length}개`, `${ready.length} flows`)}
          </Text>
          <Text textStyle="t4Regular" color="fg.neutralMuted">
            {t("홈에서 시작해 버튼을 누르고, 화면이 맞게 열리는지 매일 밤 확인해요.", "Each flow starts at home, taps buttons and checks every night that the screens open correctly.")}
          </Text>
        </VStack>
        <HStack gap="x2">
          <ActionButton variant="neutralWeak" size="medium" loading={running} disabled={running || ready.length === 0} onClick={() => void run()}>
            {t("전부 실행", "Run all")}
          </ActionButton>
          {/* 디자인 QA만: 「디자인 확인」 스텝이 든 플로우만 돈다. 없으면 만드는 법을 알려 준다 */}
          <ActionButton
            variant="neutralWeak"
            size="medium"
            loading={running}
            disabled={running || designIds.length === 0}
            title={
              designIds.length === 0
                ? t(
                    "「디자인 확인」 스텝이 든 플로우가 없어요. 플로우 만들기에서 「이 화면 디자인 확인 넣기」로 넣을 수 있어요.",
                    "No flow has a design check step. Add one with “Add a design check for this screen” when building a flow.",
                  )
                : undefined
            }
            onClick={() => void run(designIds, t(`디자인 QA 점검(플로우 ${designIds.length}개)`, `the design QA check (${designIds.length} flows)`))}
          >
            {t("디자인 QA만 실행", "Run design QA only")}
            {designIds.length > 0 ? ` (${designIds.length})` : ""}
          </ActionButton>
          <ActionButton variant="brandSolid" size="medium" onClick={() => setCreating(true)}>
            {t("새 플로우 만들기", "New flow")}
          </ActionButton>
        </HStack>
      </HStack>

      {created ? (
        <CreatedNotice
          flow={created}
          running={running}
          onRun={() => void run([created.id], t(`「${created.name}」`, `“${created.name}”`))}
          onClose={() => setCreated(null)}
        />
      ) : null}
      {/* 결과 알림은 위에 뜬다 */}
      <FloatingNotice notice={message} onClose={() => setMessage(null)} />
      {candidates.length > 0 ? <ReviewBox candidates={candidates} busy={busy} onConfirm={(ids) => void confirm(ids)} /> : null}

      <VStack gap="x3">
        {ready.length > 6 ? (
          <div className="flows-search">
            <TextField label={t("찾기", "Search")} value={query} onValueChange={({ value }) => setQuery(value)}>
              <TextFieldInput placeholder={t("이름이나 버튼으로 찾기 (예: 알림)", "Search by name or button (e.g. Notifications)")} />
            </TextField>
          </div>
        ) : null}
        {ready.length === 0 ? (
          <div className="flows-empty">
            <Text textStyle="t5Bold">{t("아직 플로우가 없어요", "No flows yet")}</Text>
            <Text textStyle="t4Regular" color="fg.neutralMuted">
              {t(
                `자주 쓰는 길 하나부터 만들어 보세요. 예: ${homeTabName} → 알림 → 「모두 읽음」 확인`,
                `Start with one path people use often. For example: ${homeTabName} → Notifications → check “Mark all as read”`,
              )}
            </Text>
            <ActionButton variant="brandSolid" size="medium" onClick={() => setCreating(true)}>
              {t("첫 플로우 만들기", "Create your first flow")}
            </ActionButton>
          </div>
        ) : (
          <StaggeredEntrance className="flows-list">
            {shown.map((flow) => (
              <StaggeredEntranceItem key={flow.id}>
                <FlowRow flow={flow} running={running} onRun={() => void run([flow.id], t(`「${flow.name}」`, `“${flow.name}”`))} />
              </StaggeredEntranceItem>
            ))}
          </StaggeredEntrance>
        )}
        {ready.length > 0 && shown.length === 0 ? (
          <Text textStyle="t4Regular" color="fg.neutralMuted">
            {t(`「${query.trim()}」에 맞는 플로우가 없어요.`, `No flows match “${query.trim()}”.`)}
          </Text>
        ) : null}
      </VStack>

      <details className="flows-more">
        <summary>{t("더 보기(PRD로 후보 만들기, 화면 지도)", "More (generate from a PRD, screen map)")}</summary>
        <VStack gap="x5" className="flows-more-body">
          <VStack gap="x2">
            <Text textStyle="t5Bold">{t("PRD로 후보 만들기", "Generate candidates from a PRD")}</Text>
            <GenerateFromPrd
              prds={prds}
              ready={prdRootSet && llmConfigured}
              onDone={(next) => {
                setMessage(next);
                void state.reload();
              }}
            />
          </VStack>
          <VStack gap="x2">
            <Text textStyle="t5Bold">{t("화면 지도", "Screen map")}</Text>
            <Text textStyle="t3Regular" color="fg.neutralMuted">
              {t(
                "플로우를 만들 때 고를 수 있는 버튼은 여기 있는 것뿐이에요. 화면에서 「버튼 눌러보기」를 켜고 점검하면 늘어나요.",
                "Only the buttons listed here can be picked when building a flow. Run a check with “Button crawl” on a screen to add more.",
              )}
            </Text>
            <ScreenMapSection />
          </VStack>
        </VStack>
      </details>
    </VStack>
  );
}

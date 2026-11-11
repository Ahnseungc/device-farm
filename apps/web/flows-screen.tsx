import { useState } from "react";
import { HStack, Text, VStack } from "@seed-design/react";

import { stepLabels, stepTarget, type FlowDocument } from "@device-farm/core/flows/schema";

import { api, errorMessage, usePoll } from "./api-client";
import { useAppConfig } from "./app-context";
import { ActionButton } from "./seed-design/ui/action-button";
import { Badge } from "./seed-design/ui/badge";
import { Callout } from "./seed-design/ui/callout";
import { Checkbox } from "./seed-design/ui/checkbox";
import { MapFlowBuilder } from "./map-flow-builder";
import { ScreenMapSection } from "./screen-map-section";
import { ProgressCircle } from "./seed-design/ui/progress-circle";
import { TextField, TextFieldInput } from "./seed-design/ui/text-field";
import "./baselines.css";
import "./flows.css";

const proposalLabels = { create: "새로", update: "수정", delete: "삭제", keep: "그대로" } as const;
const prdListId = "flow-prds";

type Message = { text: string; error: boolean };

function FlowSteps({ flow }: { flow: FlowDocument }) {
  const { homeTabName } = useAppConfig();
  return (
    <ol className="flows-steps">
      {flow.steps.map((step, index) => (
        <li key={index}>
          <Text textStyle="t3Regular">
            {stepLabels[step.type]} 「{stepTarget(step, homeTabName)}」
          </Text>
        </li>
      ))}
    </ol>
  );
}

function FlowCard({ flow, children }: { flow: FlowDocument; children?: React.ReactNode }) {
  return (
    <div className="flows-card">
      <HStack gap="x2" align="center" wrap="wrap">
        {children}
        <Text as="h4" textStyle="t4Bold">
          {flow.name}
        </Text>
        {flow.proposal ? <Badge tone="informative" variant="weak">{proposalLabels[flow.proposal]}</Badge> : null}
        {flow.status === "generation_failed" ? <Badge tone="critical" variant="weak">검증 실패</Badge> : null}
      </HStack>
      <Text textStyle="t3Regular" color="fg.neutralSubtle">
        {flow.prd} · {flow.requirement}
      </Text>
      {flow.reason ? <Text textStyle="t3Regular" color="fg.critical">{flow.reason}</Text> : null}
      {flow.steps.length > 0 ? <FlowSteps flow={flow} /> : null}
    </div>
  );
}

/** PRD를 골라 후보를 만든다. 서버가 PRD 경로·LLM 키가 없다고 하면 이유를 보여 준다. */
function GenerateBar({ prds, ready, onDone }: { prds: string[]; ready: boolean; onDone: (message: Message) => void }) {
  const [prd, setPrd] = useState("");
  const [busy, setBusy] = useState(false);

  async function generate() {
    setBusy(true);
    try {
      const result = await api.generateFlows(prd);
      onDone({ text: result.skipped ? `건너뜀: ${result.reason ?? ""}` : `후보 ${result.generated}개를 만들었습니다.`, error: false });
    } catch (error) {
      onDone({ text: errorMessage(error), error: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <HStack gap="x2" align="flex-end" wrap="wrap" className="flows-generate">
      <div className="flows-prd">
        <TextField label="PRD" value={prd} onValueChange={({ value }) => setPrd(value)} disabled={!ready}>
          <TextFieldInput placeholder="app/(shop)/benefit/_src/specs/README.md" list={prdListId} />
        </TextField>
        <datalist id={prdListId}>
          {prds.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
      </div>
      <ActionButton variant="neutralSolid" size="medium" loading={busy} disabled={busy || !ready || !prds.includes(prd)} onClick={() => void generate()}>
        후보 만들기
      </ActionButton>
    </HStack>
  );
}

export function FlowsScreen() {
  const state = usePoll(api.flows);
  const [selected, setSelected] = useState<string[]>([]);
  const [message, setMessage] = useState<Message | null>(null);
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const candidates = state.data?.candidates ?? [];
  const confirmable = candidates.filter((flow) => flow.status === "generated" && flow.proposal !== "keep").map((flow) => flow.id);
  const chosen = selected.filter((id) => confirmable.includes(id));

  const toggle = (id: string) => setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));

  async function confirm(ids?: string[]) {
    setBusy(true);
    try {
      const { confirmed } = await api.confirmFlows(ids);
      setMessage({ text: `플로우 ${confirmed}개를 확정했습니다. 확정한 플로우만 다음 점검에 포함합니다.`, error: false });
      setSelected([]);
      await state.reload();
    } catch (error) {
      setMessage({ text: errorMessage(error), error: true });
    } finally {
      setBusy(false);
    }
  }

  async function runFlowsOnly() {
    setRunning(true);
    try {
      const { runId } = await api.startRun({ kind: "dev", devices: "all", flowsOnly: true });
      setMessage({ text: `플로우 점검을 시작했습니다. (${runId})`, error: false });
    } catch (error) {
      setMessage({ text: errorMessage(error), error: true });
    } finally {
      setRunning(false);
    }
  }

  if (state.data === undefined) {
    return state.error ? (
      <Callout tone="critical" description={state.error} />
    ) : (
      <HStack gap="x2" justify="center" py="x8">
        <ProgressCircle aria-label="불러오는 중" />
        <Text color="fg.neutralMuted">불러오는 중</Text>
      </HStack>
    );
  }
  const { ready, prds, prdRootSet, llmConfigured } = state.data;

  return (
    <VStack gap="x4" className="baselines-page">
      <section className="baselines-card" aria-label="후보 만들기">
        <VStack gap="x0_5">
          <Text as="h2" textStyle="t5Bold">
            플로우 후보 만들기
          </Text>
          <Text textStyle="t3Regular" color="fg.neutralSubtle">
            PRD를 고르면 LLM이 버튼을 눌러 확인할 플로우 후보를 만들어요. 통과·실패는 점검기가 정해요.
          </Text>
        </VStack>
        {!prdRootSet ? <Callout tone="warning" description="FLOW_PRD_ROOT(프론트 체크아웃 경로)가 없어 PRD를 고를 수 없어요." /> : null}
        {prdRootSet && !llmConfigured ? <Callout tone="warning" description="FLOW_LLM_API_KEY·FLOW_LLM_BASE_URL·FLOW_LLM_MODEL이 없어 후보를 만들 수 없어요. 확정된 플로우 점검은 그대로 돌아요." /> : null}
        <GenerateBar
          prds={prds}
          ready={prdRootSet && llmConfigured}
          onDone={(next) => {
            setMessage(next);
            void state.reload();
          }}
        />
      </section>

      <MapFlowBuilder
        onAdded={(next) => {
          setMessage(next);
          void state.reload();
        }}
      />

      {message ? <Callout tone={message.error ? "critical" : "positive"} description={message.text} /> : null}

      <section className="baselines-card" aria-label="플로우 후보">
        <div className="flows-header">
          <Text as="h3" textStyle="t4Bold">
            {`후보 ${candidates.length}개`}
          </Text>
          <HStack gap="x2" wrap="wrap">
            <ActionButton variant="neutralSolid" size="medium" loading={busy} disabled={busy || chosen.length === 0} onClick={() => void confirm(chosen)}>
              고른 {chosen.length}개 확정
            </ActionButton>
            <ActionButton variant="neutralWeak" size="medium" disabled={busy || confirmable.length === 0} onClick={() => void confirm()}>
              플로우 후보 확정
            </ActionButton>
          </HStack>
        </div>
        {candidates.length === 0 ? <Text color="fg.neutralMuted">확정할 후보가 없어요.</Text> : null}
        {candidates.map((flow) => (
          <FlowCard key={`${flow.prd}:${flow.id}`} flow={flow}>
            {confirmable.includes(flow.id) ? (
              <Checkbox label="" aria-label={`${flow.name} 고르기`} size="medium" checked={chosen.includes(flow.id)} onCheckedChange={() => toggle(flow.id)} />
            ) : null}
          </FlowCard>
        ))}
      </section>

      <section className="baselines-card" aria-label="확정 플로우">
        <div className="flows-header">
          <Text as="h3" textStyle="t4Bold">
            {`확정 ${ready.length}개 · 홈에서 시작해 버튼·탭을 눌러 확인해요`}
          </Text>
          <ActionButton variant="neutralSolid" size="medium" loading={running} disabled={running || ready.length === 0} onClick={() => void runFlowsOnly()}>
            플로우만 점검
          </ActionButton>
        </div>
        <Text textStyle="t3Regular" color="fg.neutralSubtle">
          설치 없이 지금 깔린 dev 앱으로 연결된 기기 전부에서 돌아요. 진행은 오른쪽 패널에 스텝별로 보여요.
        </Text>
        {ready.map((flow) => (
          <FlowCard key={flow.id} flow={flow} />
        ))}
      </section>

      <ScreenMapSection />
    </VStack>
  );
}

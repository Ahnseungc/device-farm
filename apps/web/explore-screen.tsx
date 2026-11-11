import { useState } from "react";
import { HStack, Text, VStack } from "@seed-design/react";

import type { ExploreAction, ExploreIssue, ExploreRun } from "@device-farm/core/explore/actions";

import { api, errorMessage, joinPath, resultFileUrl, usePoll, type DeviceWithState } from "./api-client";
import { ActionButton } from "./seed-design/ui/action-button";
import { Badge } from "./seed-design/ui/badge";
import { Callout } from "./seed-design/ui/callout";
import { Checkbox, CheckboxGroup } from "./seed-design/ui/checkbox";
import { ProgressCircle } from "./seed-design/ui/progress-circle";
import { ResultSection } from "./seed-design/ui/result-section";
import "./explore.css";

type Notice = { text: string; error: boolean };

function actionLabel(action: ExploreAction): string {
  if (action.kind === "fill") return `입력 ${action.label}`;
  return `${action.role === "link" ? "링크" : "버튼"} ${action.name}`;
}

function deviceName(devices: DeviceWithState[], id: string): string {
  const device = devices.find((item) => item.id === id);
  return device ? `${device.model} · ${device.osVersion}` : id;
}

export function ExploreScreen() {
  const devices = usePoll(api.devices);
  const runs = usePoll(api.latestExplore);
  const list = devices.data ?? [];

  return (
    <VStack gap="x4" className="explore-page">
      <ExploreForm devices={list} onStarted={() => void runs.reload()} />
      <Callout
        tone="informative"
        title="허용 목록"
        description="허용 목록은 화면에서 고치지 않습니다. explore/allowlist.json을 고쳐 주세요."
      />
      {runs.error ? <Callout tone="critical" description={runs.error} /> : null}
      {runs.data === undefined && !runs.error ? (
        <HStack gap="x2" justify="center" py="x8">
          <ProgressCircle aria-label="불러오는 중" />
          <Text color="fg.neutralMuted">불러오는 중</Text>
        </HStack>
      ) : null}
      {runs.data && runs.data.length === 0 ? (
        <div className="explore-card">
          <ResultSection
            size="medium"
            title="아직 탐색한 기록이 없어요"
            description="위에서 기기를 고르고 탐색을 실행하면 결과가 여기에 보여요."
          />
        </div>
      ) : null}
      {(runs.data ?? []).map((run) => (
        <RunSection key={`${run.runId}-${run.deviceId}`} run={run} title={deviceName(list, run.deviceId)} />
      ))}
    </VStack>
  );
}

function ExploreForm({ devices, onStarted }: { devices: DeviceWithState[]; onStarted: () => void }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [message, setMessage] = useState<Notice | null>(null);
  const [pending, setPending] = useState(false);

  const toggle = (id: string) =>
    setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));

  async function start() {
    setPending(true);
    try {
      const { runId } = await api.startExplore(selected.length > 0 ? selected : "all");
      setMessage({ text: `탐색을 시작했습니다. (${runId})`, error: false });
      onStarted();
    } catch (error) {
      setMessage({ text: errorMessage(error), error: true });
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="explore-card" aria-label="탐색 실행">
      <Text as="h2" textStyle="t5Bold">
        탐색 실행 (dev 빌드)
      </Text>
      <CheckboxGroup label="기기 (고르지 않으면 전체)">
        {devices.map((device) => (
          <Checkbox
            key={device.id}
            size="medium"
            label={`${device.model} · ${device.osVersion}`}
            checked={selected.includes(device.id)}
            onCheckedChange={() => toggle(device.id)}
          />
        ))}
      </CheckboxGroup>
      <HStack gap="x3" align="center" wrap="wrap">
        <ActionButton variant="neutralSolid" size="medium" loading={pending} disabled={pending} onClick={() => void start()}>
          탐색 실행
        </ActionButton>
        {message ? <NoticeText notice={message} /> : null}
      </HStack>
    </section>
  );
}

function NoticeText({ notice }: { notice: Notice }) {
  return (
    <Text textStyle="t3Regular" color={notice.error ? "fg.critical" : "fg.neutralMuted"}>
      {notice.text}
    </Text>
  );
}

function RunSection({ run, title }: { run: ExploreRun; title: string }) {
  const actionsOf = (pathId: string) => run.paths.find((item) => item.id === pathId)?.actions ?? [];
  return (
    <section className="explore-card" aria-label={`${title} 탐색 결과`}>
      <div className="explore-head">
        <Text as="h2" textStyle="t5Bold">
          {title}
        </Text>
        <HStack gap="x1_5" wrap="wrap">
          <Badge tone="neutral" variant="weak">{`경로 ${run.paths.length}개`}</Badge>
          <Badge tone="positive" variant="weak">{`깨끗한 경로 ${run.cleanPathIds.length}개`}</Badge>
          <Badge tone="informative" variant={run.finishedAt ? "weak" : "outline"}>
            {run.finishedAt ? "끝남" : "진행 중"}
          </Badge>
        </HStack>
      </div>

      <VStack gap="x2" align="stretch">
        <Text as="h3" textStyle="t4Bold">
          오류 {run.issues.length}건
        </Text>
        {run.issues.map((issue, index) => (
          <IssueItem key={`${issue.pathId}-${index}`} run={run} issue={issue} actions={actionsOf(issue.pathId)} />
        ))}
      </VStack>

      {run.replayFailures.length > 0 ? (
        <VStack gap="x2" align="stretch">
          <Text as="h3" textStyle="t4Bold">
            재생 실패 {run.replayFailures.length}건
          </Text>
          {run.replayFailures.map((failure) => (
            <Text key={failure.pathId} textStyle="t3Regular" color="fg.neutralMuted">
              {failure.pathId}: {failure.message}
            </Text>
          ))}
        </VStack>
      ) : null}

      <VStack gap="x2" align="stretch">
        <Text as="h3" textStyle="t4Bold">
          차단된 요청 {run.blocked.length}건
        </Text>
        {run.blocked.length > 0 ? (
          <div className="explore-scroll">
            <table className="explore-table">
              <thead>
                <tr>
                  <th scope="col">메서드</th>
                  <th scope="col">경로</th>
                  <th scope="col">이유</th>
                  <th scope="col">탐색 경로</th>
                </tr>
              </thead>
              <tbody>
                {run.blocked.map((request, index) => (
                  <tr key={`${request.pathId}-${request.at}-${index}`}>
                    <td>{request.method}</td>
                    <td>{request.path}</td>
                    <td>{request.reason}</td>
                    <td>{request.pathId}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </VStack>
    </section>
  );
}

interface IssueItemProps {
  run: ExploreRun;
  issue: ExploreIssue;
  actions: ExploreAction[];
}

function IssueItem({ run, issue, actions }: IssueItemProps) {
  const [replayText, setReplayText] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);

  async function replay() {
    setBusy(true);
    try {
      const issues = await api.replay({ runId: run.runId, deviceId: run.deviceId, pathId: issue.pathId });
      const text = issues.length > 0 ? `다시 나옴: ${issues.map((item) => item.kind).join(", ")}` : "다시 돌렸더니 오류가 없습니다.";
      setReplayText({ text, error: false });
    } catch (error) {
      setReplayText({ text: errorMessage(error), error: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="explore-issue">
      <HStack gap="x2" align="center" wrap="wrap">
        <Badge tone="critical" variant="solid">
          {issue.kind}
        </Badge>
        <Text textStyle="t4Regular">{issue.message}</Text>
      </HStack>
      <div className="explore-path" role="list" aria-label="재현 경로">
        {actions.length === 0 ? (
          <span role="listitem">
            <Badge tone="neutral" variant="outline">
              첫 화면
            </Badge>
          </span>
        ) : null}
        {actions.map((action, index) => (
          <span key={index} role="listitem">
            <Badge tone="neutral" variant="weak">
              {actionLabel(action)}
            </Badge>
          </span>
        ))}
      </div>
      <HStack gap="x3" align="center" wrap="wrap">
        {issue.screenshot ? (
          <a className="explore-link" href={resultFileUrl(issue.screenshot)} target="_blank" rel="noreferrer">
            스크린샷
          </a>
        ) : null}
        {issue.logDir ? (
          <>
            <a className="explore-link" href={resultFileUrl(joinPath(issue.logDir, "logs.jsonl"))} target="_blank" rel="noreferrer">
              로그
            </a>
            <a className="explore-link" href={resultFileUrl(joinPath(issue.logDir, "video.mp4"))} target="_blank" rel="noreferrer">
              영상
            </a>
          </>
        ) : null}
        <ActionButton variant="neutralWeak" size="small" loading={busy} disabled={busy} onClick={() => void replay()}>
          다시 돌리기
        </ActionButton>
        {replayText ? <NoticeText notice={replayText} /> : null}
      </HStack>
    </article>
  );
}

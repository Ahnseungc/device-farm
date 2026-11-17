import { useState } from "react";
import { HStack, Text, VStack } from "@seed-design/react";

import type { ExploreAction, ExploreIssue, ExploreRun } from "@device-farm/core/explore/actions";

import { issueLabel } from "./issue-labels";
import { LoadingState } from "./loading-state";
import { MetaLine } from "./meta-line";
import { FloatingNotice, type Notice } from "./floating-notice";
import { api, errorMessage, joinPath, resultFileUrl, usePoll, type DeviceWithState } from "./api-client";
import { plural, t } from "./i18n";
import { ActionButton } from "./seed-design/ui/action-button";
import { Badge } from "./seed-design/ui/badge";
import { Callout } from "./seed-design/ui/callout";
import { ResultSection } from "./seed-design/ui/result-section";
import "./explore.css";

function actionLabel(action: ExploreAction): string {
  if (action.kind === "fill") return `${t("입력", "Fill")} ${action.label}`;
  return `${action.role === "link" ? t("링크", "Link") : t("버튼", "Button")} ${action.name}`;
}

function deviceName(devices: DeviceWithState[], id: string): string {
  const device = devices.find((item) => item.id === id);
  return device ? `${device.model} ${device.osVersion}` : id;
}

export function ExploreScreen() {
  const devices = usePoll(api.devices);
  const runs = usePoll(api.latestExplore);
  const [selected, setSelected] = useState<string[]>([]);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [pending, setPending] = useState(false);
  // 기기·탐색 기록이 다 온 뒤에 그린다(늦게 온 기록이 끼어들며 밀어내지 않게)
  if ((devices.data === undefined && !devices.error) || (runs.data === undefined && !runs.error)) return <LoadingState />;
  const list = devices.data ?? [];
  const toggle = (id: string) => setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));

  async function start() {
    setPending(true);
    try {
      await api.startExplore(selected.length > 0 ? selected : "all");
      setNotice({ text: t("탐색을 시작했어요. 경로마다 결과가 아래에 쌓여요.", "Explore started. Results for each path stack up below."), error: false });
      await runs.reload();
    } catch (error) {
      setNotice({ text: errorMessage(error), error: true });
    } finally {
      setPending(false);
    }
  }

  return (
    <VStack gap="x5" className="explore-page">
      <FloatingNotice notice={notice} onClose={() => setNotice(null)} />
      <HStack justify="space-between" align="flex-end" gap="x3" wrap="wrap">
        <VStack gap="x1">
          <Text as="h1" textStyle="t7Bold">
            {t("탐색", "Explore")}
          </Text>
          <Text textStyle="t4Regular" color="fg.neutralMuted">
            {t("버튼을 차례로 눌러 갈 수 있는 길을 훑고, 오류가 난 길은 다시 돌려 확인해요. dev 빌드에서만 돌아요.", "Taps through buttons to cover every reachable path, then replays the ones that errored. Runs on dev builds only.")}
          </Text>
        </VStack>
        <ActionButton variant="brandSolid" size="medium" loading={pending} disabled={pending || list.length === 0} onClick={() => void start()}>
          {selected.length > 0 ? t(`${selected.length}대로 탐색 시작`, `Explore on ${plural(selected.length, "device")}`) : t("탐색 시작", "Start explore")}
        </ActionButton>
      </HStack>
      {list.length > 1 ? (
        <div className="explore-devices" role="group" aria-label={t("탐색할 기기(고르지 않으면 전체)", "Devices to explore (all if none selected)")}>
          {list.map((device) => (
            <button key={device.id} type="button" className="explore-device" aria-pressed={selected.includes(device.id)} onClick={() => toggle(device.id)}>
              {`${device.model} ${device.osVersion}`}
            </button>
          ))}
        </div>
      ) : null}
      {runs.error ? <Callout tone="critical" description={runs.error} /> : null}
      {runs.data && runs.data.length === 0 ? (
        <div className="explore-card">
          <ResultSection size="medium" title={t("아직 탐색한 기록이 없어요", "No explore runs yet")} description={t("「탐색 시작」을 누르면 결과가 여기에 쌓여요.", "Press “Start explore” and the results stack up here.")} />
        </div>
      ) : null}
      {(runs.data ?? []).map((run) => (
        <RunSection key={`${run.runId}-${run.deviceId}`} run={run} title={deviceName(list, run.deviceId)} />
      ))}
      <Text textStyle="t3Regular" color="fg.neutralSubtle">
        {t("데이터를 바꾸는 요청은 막아요. 열어 줄 요청은 explore/allowlist.json에서 고쳐요.", "Requests that change data are blocked. Allow specific ones in explore/allowlist.json.")}
      </Text>
    </VStack>
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
    <section className="explore-run" aria-label={t(`${title} 탐색 결과`, `${title} explore results`)}>
      <div className="explore-hero">
        <HStack gap="x2" align="center" wrap="wrap">
          <Text as="h2" textStyle="t6Bold">
            {run.issues.length > 0
              ? t(`길 ${run.paths.length}개를 훑어 오류 ${run.issues.length}건을 찾았어요`, `Covered ${plural(run.paths.length, "path")} and found ${plural(run.issues.length, "error")}`)
              : t(`길 ${run.paths.length}개를 훑었는데 오류가 없었어요`, `Covered ${plural(run.paths.length, "path")} with no errors`)}
          </Text>
          {run.finishedAt ? null : (
            <Badge tone="informative" variant="weak">
              {t("도는 중", "Running")}
            </Badge>
          )}
        </HStack>
        <Text textStyle="t3Regular" color="fg.neutralSubtle"><MetaLine items={[title, t(`깨끗한 길 ${run.cleanPathIds.length}개`, `${run.cleanPathIds.length} clean`), t(`막은 요청 ${run.blocked.length}건`, plural(run.blocked.length, "blocked request"))]} /></Text>
      </div>

      {run.issues.length > 0 ? (
        <VStack gap="x3">
          {run.issues.map((issue, index) => (
            <IssueItem key={`${issue.pathId}-${index}`} run={run} issue={issue} actions={actionsOf(issue.pathId)} />
          ))}
        </VStack>
      ) : null}

      {run.replayFailures.length > 0 ? (
        <details className="explore-more">
          <summary>{t(`다시 돌리기 실패 ${run.replayFailures.length}건`, `Replay failures: ${run.replayFailures.length}`)}</summary>
          {run.replayFailures.map((failure) => (
            <Text key={failure.pathId} textStyle="t3Regular" color="fg.neutralMuted">
              {failure.pathId}: {failure.message}
            </Text>
          ))}
        </details>
      ) : null}

      {run.blocked.length > 0 ? (
        <details className="explore-more">
          <summary>{t(`막은 요청 ${run.blocked.length}건`, `Blocked requests: ${run.blocked.length}`)}</summary>
          <div className="explore-scroll">
            <table className="explore-table">
              <thead>
                <tr>
                  <th scope="col">{t("메서드", "Method")}</th>
                  <th scope="col">{t("경로", "Path")}</th>
                  <th scope="col">{t("이유", "Reason")}</th>
                  <th scope="col">{t("탐색 길", "Explore path")}</th>
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
        </details>
      ) : null}
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
      const text = issues.length > 0 ? `${t("다시 나왔어요", "Reproduced")}: ${issues.map((item) => issueLabel(item.kind)).join(", ")}` : t("다시 돌렸더니 오류가 없어요.", "Replayed with no errors.");
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
        <Badge tone="critical" variant="weak">
          {issueLabel(issue.kind)}
        </Badge>
      </HStack>
      <Text textStyle="t4Regular" className="explore-issue-message">
        {issue.message}
      </Text>
      <div className="explore-path" role="list" aria-label={t("재현 경로", "Steps to reproduce")}>
        {actions.length === 0 ? (
          <span role="listitem">
            <Badge tone="neutral" variant="outline">
              {t("첫 화면", "First screen")}
            </Badge>
          </span>
        ) : null}
        {actions.map((action, index) => (
          <span key={index} role="listitem" className="explore-path-step">
            {index > 0 ? <span aria-hidden="true">›</span> : null}
            <Badge tone="neutral" variant="weak">
              {actionLabel(action)}
            </Badge>
          </span>
        ))}
      </div>
      <HStack gap="x3" align="center" wrap="wrap">
        {issue.screenshot ? (
          <a className="explore-link" href={resultFileUrl(issue.screenshot)} target="_blank" rel="noreferrer">
            {t("스크린샷", "Screenshot")}
          </a>
        ) : null}
        {issue.logDir ? (
          <>
            <a className="explore-link" href={resultFileUrl(joinPath(issue.logDir, "logs.jsonl"))} target="_blank" rel="noreferrer">
              {t("로그", "Logs")}
            </a>
            <a className="explore-link" href={resultFileUrl(joinPath(issue.logDir, "video.mp4"))} target="_blank" rel="noreferrer">
              {t("영상", "Video")}
            </a>
          </>
        ) : null}
        <ActionButton variant="neutralWeak" size="small" loading={busy} disabled={busy} onClick={() => void replay()}>
          {t("다시 돌리기", "Replay")}
        </ActionButton>
        {/* 다시 돌린 결과 자리를 미리 둔다(나타날 때 카드가 들썩이지 않게) */}
        <span className="explore-replay">{replayText ? <NoticeText notice={replayText} /> : null}</span>
      </HStack>
    </article>
  );
}

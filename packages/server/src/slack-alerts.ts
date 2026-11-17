import { WebSocket } from "ws";

import type { AppConfig } from "@device-farm/core/config/app-config";
import type { DeviceOutcome, DeviceRun, DeviceScreen } from "@device-farm/core/device/types";
import { findingLabels, screenMatches } from "@device-farm/core/policy/rules";
import { designAlertBlocks, designAlertOf, designAlertText, designDiffsOf, type DesignAlert } from "@device-farm/core/slack/design-alert";
import { deviceFinishAlert, type FinishAlert } from "@device-farm/core/slack/finish-alert";
import { failureAlertBlocks, failureAlertOf, failureAlertText, failureTypeLabels, type FailureAlert } from "@device-farm/core/slack/failure-alert";
import { fixPrActionId } from "@device-farm/core/slack/fix-pr";
import { alertStatusLabels, figmaUrl, type AlertStatus, maxFigmaLinks, policyAlertBlocks, policyAlertsOf, policyAlertText, statusOfAction, urgentFindings, type AlertStatusInfo, type PolicyAlert } from "@device-farm/core/slack/policy-alert";
import { createFixPrRunner, fixPrConfigFromEnv } from "@device-farm/engine/fix-pr/fix-pr";
import { confluenceConfigFromEnv } from "@device-farm/engine/policy/confluence";
import { readFrontFigmaMap } from "@device-farm/engine/policy/front-figma";
import { readPageOwnerName } from "@device-farm/engine/policy/people";
import { addIgnore, readAllPageRules } from "@device-farm/engine/policy/rules-store";
import { readSnapshot, readSources } from "@device-farm/engine/policy/store";
import { readAlerts, saveAlert, type SentAlert } from "@device-farm/engine/slack/alert-store";
import { createSlackClient, openSocketUrl, type SlackClient } from "@device-farm/engine/slack/client";

import { createFixPrButton, type FixPrButton } from "./fix-pr-button";

/**
 * 정책·피그마·앱 불일치를 슬랙 채널(`SLACK_CHANNEL_DEV`·`SLACK_CHANNEL_PROD`)에 알리고, 메시지 버튼(처리 완료·확인 중·문제 아님)으로 상태를 받는다.
 * 버튼은 Socket Mode로 받는다 — 디바이스팜은 로컬 PC라 슬랙이 들어올 공개 주소가 없다.
 * 토큰(`SLACK_BOT_TOKEN`)이 없으면 아무것도 하지 않는다(점검은 그대로).
 */

/**
 * 한 점검에서 하나씩 보내는 알림 수 (작성자 판단). 넘는 것은 요약 한 건으로 묶는다.
 * 정책 49개 규칙이 화면 90곳에 걸려, 첫 점검에서 어긋남이 수십 건 나올 수 있다(2026-11-12).
 */
export const maxAlertsPerRun = 5;

/** 다시 연결하기까지 기다리는 시간 (작성자 판단) */
const reconnectMs = 10_000;

export interface SlackAlerts {
  /** 화면 하나의 점검이 끝날 때 부른다. 앱 버그 후보·실패는 바로 보낸다 */
  onScreenFinished: (run: DeviceRun, outcome: DeviceOutcome, screen: DeviceScreen) => Promise<void>;
  /** 점검이 끝나면 부른다. 아직 안 보낸 것을 보내고, 한도를 넘거나 급하지 않은 것은 요약 한 건으로 */
  onRunFinished: (run: DeviceRun) => Promise<void>;
  /** 디바이스팜 화면에서 상태를 바꾼다. 슬랙 메시지도 같이 고친다(토큰이 없으면 기록만) */
  setStatus: (key: string, status: Exclude<AlertStatus, "open">, by?: string) => Promise<boolean>;
  /** 봇·탐색 점검이 끝나면 한 줄 요약을 SLACK_CHANNEL_DEV에 보낸다. 기기 점검은 onRunFinished가 보낸다 */
  onFinished: (alert: FinishAlert) => Promise<void>;
  stop: () => void;
}

type AnyAlert = PolicyAlert | FailureAlert;
type StoredAlert = SentAlert["alert"];
const isFailure = (alert: StoredAlert): alert is FailureAlert => "type" in alert && alert.type === "failure";
const isDesign = (alert: StoredAlert): alert is DesignAlert => "type" in alert && alert.type === "design";
const alertText = (alert: StoredAlert) => (isDesign(alert) ? designAlertText(alert) : isFailure(alert) ? failureAlertText(alert) : policyAlertText(alert));
/** 「수정 PR 만들기」 버튼: 수정 PR 설정(FARM_FIX_PR_*)이 있을 때 오류 알림(실패·디자인)에만 */
const fixPrEnabled = () => fixPrConfigFromEnv() !== null;
const alertBlocks = (alert: StoredAlert, status?: AlertStatusInfo) =>
  isDesign(alert) ? designAlertBlocks(alert, status, fixPrEnabled()) : isFailure(alert) ? failureAlertBlocks(alert, status, fixPrEnabled()) : policyAlertBlocks(alert, status);
const alertLabel = (alert: AnyAlert): string => (isFailure(alert) ? failureTypeLabels[alert.finding].replace(/^:[a-z_]+: /, "") : findingLabels[alert.finding]);
/** 바로 보내는 것: 점검 실패 전부와 앱 버그 쪽 정책 불일치 */
const isUrgent = (alert: AnyAlert) => isFailure(alert) || urgentFindings.includes(alert.finding);

const failureAlertsOf = (run: DeviceRun) =>
  run.outcomes.flatMap((outcome) => outcome.screens.flatMap((screen) => failureAlertOf(run, outcome, screen) ?? []));

const channelFor = (run: DeviceRun) => (run.kind === "prod" ? process.env.SLACK_CHANNEL_PROD : process.env.SLACK_CHANNEL_DEV)?.trim();

const timeLabel = (date: Date) => date.toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

type Owner = { name?: string; slackId?: string };

function alertContext(owners: ReadonlyMap<string, Owner>) {
  const snapshot = readSnapshot();
  const pages = readAllPageRules();
  const front = readFrontFigmaMap()?.routes ?? {};
  // 테스트 경로(screenAliases)는 실제 화면의 피그마 노드를 쓴다
  const sources = readSources();
  return {
    policyPage: (pageId: string) => {
      const page = snapshot.pages[pageId];
      const owner = owners.get(pageId);
      return page ? { title: page.title, url: page.webUrl, ownerName: owner?.name, ownerSlackId: owner?.slackId } : null;
    },
    figmaRefs: (aliasOrPath: string) => figmaRefsOf(sources.screenAliases?.[aliasOrPath] ?? aliasOrPath),
  };
  function figmaRefsOf(screenPath: string): string[] {
    return [
      ...new Set([
        ...Object.entries(front).flatMap(([route, refs]) => (screenMatches(route, screenPath) ? refs : [])),
        ...pages.filter((page) => page.screens.some((pattern) => screenMatches(pattern, screenPath))).flatMap((page) => page.figma),
      ]),
    ];
  }
}

type BlockActionPayload = {
  type: string;
  user?: { id?: string };
  actions?: { action_id?: string; value?: string }[];
};

/**
 * 알림 상태를 바꾼다(슬랙 버튼·디바이스팜 「문제」 화면이 같이 쓴다). 슬랙에 하나로 보낸 알림이면 그 메시지도 고친다(버튼은 사라진다).
 * 정책·디자인 알림의 「문제 아님」은 무시 목록에 넣어 다음 점검부터 세지 않는다(정책·피그마가 바뀌면 풀린다). 모르는 키면 false.
 */
export async function applyAlertStatus(key: string, status: Exclude<AlertStatus, "open">, by: string | undefined, client: SlackClient | null, log: (message: string) => void): Promise<boolean> {
  const sent = readAlerts()[key];
  if (!sent) return false;
  const updated = { ...sent, status, by, at: timeLabel(new Date()) };
  saveAlert(key, updated);
  if (status === "not-issue" && !isFailure(sent.alert)) {
    const reason = `문제 아님 (${by ?? "?"})`;
    // 피그마 차이 묶음은 묶인 문구를 전부 무시한다
    const targets = isDesign(sent.alert) ? sent.alert.diffs : [sent.alert];
    for (const target of targets) addIgnore({ key: target.ignoreKey, hash: target.ignoreHash, reason, at: new Date().toISOString() });
  }
  if (client && sent.ts) await client.update(sent.channel, sent.ts, alertText(sent.alert), alertBlocks(sent.alert, updated));
  log(`알림 ${alertStatusLabels[status]}: ${sent.alert.path}`);
  return true;
}

async function handleAction(client: SlackClient, payload: BlockActionPayload, fixPr: FixPrButton | null, log: (message: string) => void): Promise<void> {
  const action = payload.actions?.[0];
  if (action?.action_id === fixPrActionId) {
    if (fixPr && action.value) await fixPr.start(action.value, payload.user?.id);
    else log("수정 PR 버튼: FARM_FIX_PR_GITHUB_TOKEN·FARM_FIX_PR_REPO가 없어요");
    return;
  }
  const status = action?.action_id ? statusOfAction(action.action_id) : null;
  const key = action?.value;
  if (!status || !key) return;
  if (!(await applyAlertStatus(key, status, payload.user?.id, client, log))) log(`슬랙 버튼: 모르는 알림 ${key}`);
}

/** Socket Mode: 연결 → 이벤트마다 바로 ack → 버튼이면 처리. 끊기면 다시 연결한다 */
function connectSocket(appToken: string, client: SlackClient, fixPr: FixPrButton | null, log: (message: string) => void): () => void {
  let socket: WebSocket | null = null;
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(() => void connect(), reconnectMs);
    timer.unref();
  };

  const connect = async () => {
    try {
      socket = new WebSocket(await openSocketUrl(appToken));
    } catch (error) {
      log(error instanceof Error ? error.message : String(error));
      return schedule();
    }
    socket.on("message", (raw) => {
      let envelope: { envelope_id?: string; type?: string; payload?: BlockActionPayload };
      try {
        envelope = JSON.parse(raw.toString()) as typeof envelope;
      } catch {
        // 슬랙이 보낸 글자가 JSON이 아니면 처리할 게 없다
        return;
      }
      if (envelope.envelope_id) socket?.send(JSON.stringify({ envelope_id: envelope.envelope_id }));
      if (envelope.type === "interactive" && envelope.payload?.type === "block_actions") {
        handleAction(client, envelope.payload, fixPr, log).catch((error: unknown) => log(`슬랙 버튼 처리 실패: ${error instanceof Error ? error.message : String(error)}`));
      }
    });
    socket.on("close", schedule);
    socket.on("error", (error) => log(`슬랙 Socket Mode 오류: ${error.message}`));
  };

  void connect();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    socket?.close();
  };
}

/** 점검 결과의 정책 페이지 id */
const pageIdsOf = (run: DeviceRun) => [
  ...new Set(run.outcomes.flatMap((outcome) => outcome.screens.flatMap((screen) => (screen.checks ?? []).flatMap((check) => ("pageId" in check && typeof check.pageId === "string" ? [check.pageId] : []))))),
];

/**
 * 정책서 작성자(Confluence 담당자) → 슬랙 계정. 이름으로 찾는다(Confluence가 이메일을 숨긴다).
 * 한 번 찾은 것은 서버가 떠 있는 동안 기억한다. 못 찾으면 이름만 쓴다.
 */
async function resolveOwners(app: AppConfig, pageIds: string[], cache: Map<string, Owner>, client: SlackClient, log: (message: string) => void): Promise<Map<string, Owner>> {
  const config = confluenceConfigFromEnv(app.policy.confluence);
  for (const pageId of pageIds) {
    if (cache.has(pageId) || !config) continue;
    try {
      const name = (await readPageOwnerName(config, pageId, (url, init) => fetch(url, init))) ?? undefined;
      cache.set(pageId, { name, slackId: name ? ((await client.findUserIdByName(name)) ?? undefined) : undefined });
    } catch (error) {
      log(`정책서 작성자 확인 실패(${pageId}): ${error instanceof Error ? error.message : String(error)}`);
      cache.set(pageId, {});
    }
  }
  return cache;
}

/** 한도를 넘거나 급하지 않은 것 요약: 분류별 수와 화면 목록 일부 */
function overflowBlocks(rest: AnyAlert[], run: DeviceRun): unknown[] {
  const byFinding = new Map<string, number>();
  for (const alert of rest) byFinding.set(alertLabel(alert), (byFinding.get(alertLabel(alert)) ?? 0) + 1);
  const counts = [...byFinding].map(([label, count]) => `${label} ${count}`).join(" · ");
  const paths = [...new Set(rest.map((alert) => `\`${alert.path}\``))].slice(0, 10).join(", ");
  return [
    { type: "section", text: { type: "mrkdwn", text: `:large_purple_circle: *점검 요약 · ${rest.length}건 더* (${run.kind} ${run.version})\n${counts}` } },
    { type: "section", text: { type: "mrkdwn", text: `*화면* ${paths}${rest.length > 10 ? " …" : ""}` } },
    { type: "context", elements: [{ type: "mrkdwn", text: `앱 버그 후보·실패는 한 점검에 ${maxAlertsPerRun}건까지 하나씩 보내요. 나머지와 정책 문서 갱신·앱 반영 전 같은 급하지 않은 것은 디바이스팜 결과·정책 탭에서 확인·무시할 수 있어요.` }] },
  ];
}

export function startSlackAlerts(app: AppConfig, log: (message: string) => void): SlackAlerts {
  const botToken = process.env.SLACK_BOT_TOKEN?.trim();
  if (!botToken) return { onScreenFinished: async () => undefined, onRunFinished: async () => undefined, onFinished: async () => undefined, setStatus: (key, status, by) => applyAlertStatus(key, status, by, null, log), stop: () => undefined };
  const client = createSlackClient(botToken);
  const appToken = process.env.SLACK_APP_TOKEN?.trim();
  const fixConfig = fixPrConfigFromEnv();
  const fixPr: FixPrButton | null = fixConfig
    ? createFixPrButton({
        client,
        runner: createFixPrRunner(fixConfig, log, app.name),
        readAlerts: () => readAlerts(),
        saveAlert: (key, sent) => saveAlert(key, sent),
        render: (sent) => ({ text: alertText(sent.alert), blocks: alertBlocks(sent.alert, sent) }),
        log,
      })
    : null;
  fixPr?.recover().catch((error: unknown) => log(`수정 PR 상태 복구 실패: ${error instanceof Error ? error.message : String(error)}`));
  const stopSocket = appToken ? connectSocket(appToken, client, fixPr, log) : () => undefined;
  if (!appToken) log("SLACK_APP_TOKEN이 없어 슬랙 버튼은 받지 않아요(알림은 보내요).");
  const owners = new Map<string, Owner>();

  /** 점검마다 하나씩 보낸 수 */
  const sentPerRun = new Map<string, number>();
  /** 화면 알림과 점검 끝 알림이 겹쳐 같은 건을 두 번 보내지 않게 한 줄로 세운다 */
  let queue: Promise<void> = Promise.resolve();
  const enqueue = (task: () => Promise<void>) => {
    queue = queue.then(task).catch((error: unknown) => log(`슬랙 알림 실패: ${error instanceof Error ? error.message : String(error)}`));
    return queue;
  };

  /** 한도 안이면 하나 보낸다. 보냈으면 true */
  const sendOne = async (alert: AnyAlert, channel: string, runId: string): Promise<boolean> => {
    const count = sentPerRun.get(runId) ?? 0;
    if (count >= maxAlertsPerRun) return false;
    const posted = await client.post(channel, alertText(alert), alertBlocks(alert));
    saveAlert(alert.key, { alert, channel: posted.channel, ts: posted.ts, sentAt: new Date().toISOString(), status: "open" });
    sentPerRun.set(runId, count + 1);
    log(`슬랙 알림: ${alertLabel(alert)} · ${alert.path}`);
    return true;
  };

  /** 전에 묶어 보낸 피그마 차이 키. 같은 차이는 다시 알리지 않는다 */
  const sentDesignKeys = () => new Set(Object.values(readAlerts()).flatMap((sent) => (isDesign(sent.alert) ? sent.alert.diffs.map((diff) => diff.key) : [])));
  /** QA 계정 주인 이름(화면에 나오는 사용자 데이터라 거른다) */
  const accountNames = (process.env.FARM_ACCOUNT_NAME ?? "").split(",").map((name) => name.trim()).filter(Boolean);

  /** 점검이 끝나면 처음 본 피그마 차이를 한 건으로 묶어 보낸다(한도와 따로) */
  const sendDesign = async (run: DeviceRun, channel: string) => {
    const known = sentDesignKeys();
    const fresh = designDiffsOf(run, accountNames).filter((diff) => !known.has(diff.key));
    const context = alertContext(owners);
    const alert = designAlertOf(run, fresh, (path) => context.figmaRefs(path).slice(0, maxFigmaLinks).map(figmaUrl));
    if (!alert) return;
    const posted = await client.post(channel, designAlertText(alert), designAlertBlocks(alert));
    saveAlert(alert.key, { alert, channel: posted.channel, ts: posted.ts, sentAt: new Date().toISOString(), status: "open" });
    log(`슬랙 디자인 오류: 피그마 차이 ${alert.diffs.length}건 · 화면 ${alert.screens.length}곳`);
  };

  const policyAlertsFor = async (run: DeviceRun) => {
    await resolveOwners(app, pageIdsOf(run), owners, client, log);
    return policyAlertsOf(run, alertContext(owners));
  };

  return {
    onScreenFinished: (run, outcome, screen) =>
      enqueue(async () => {
        const channel = channelFor(run);
        if (!channel) return;
        const one = { ...run, outcomes: [{ ...outcome, screens: [screen] }] };
        const sent = readAlerts();
        const alerts: AnyAlert[] = [...(await policyAlertsFor(one)).filter(isUrgent), ...failureAlertsOf(one)].filter((alert) => !sent[alert.key]);
        for (const alert of alerts) await sendOne(alert, channel, run.runId);
      }),
    onRunFinished: (run) =>
      enqueue(async () => {
        const channel = channelFor(run);
        if (!channel) return;
        await sendDesign(run, channel);
        const sent = readAlerts();
        const fresh: AnyAlert[] = [...(await policyAlertsFor(run)), ...failureAlertsOf(run)].filter((alert) => !sent[alert.key]);
        // 바로 보낼 것(화면 알림에서 한도에 걸리지 않고 남은 것, CLI처럼 화면 알림 없이 끝만 부른 경우)을 먼저
        const rest: AnyAlert[] = [];
        for (const alert of fresh) {
          if (!(isUrgent(alert) && (await sendOne(alert, channel, run.runId)))) rest.push(alert);
        }
        if (rest.length > 0) {
          await client.post(channel, `점검 요약 · ${rest.length}건 더`, overflowBlocks(rest, run));
          // 요약으로 보낸 것도 다시 보내지 않는다(버튼 없음, 상태는 디바이스팜에서)
          const now = new Date().toISOString();
          for (const alert of rest) saveAlert(alert.key, { alert, channel, ts: "", sentAt: now, status: "open" });
          log(`슬랙 점검 요약 ${rest.length}건`);
        }
        // 문제가 없어도 끝났다는 한 줄은 남긴다
        const finish = deviceFinishAlert(run);
        await client.post(channel, finish.text, finish.blocks);
      }),
    onFinished: (alert) =>
      enqueue(async () => {
        const channel = process.env.SLACK_CHANNEL_DEV?.trim();
        if (!channel) return;
        await client.post(channel, alert.text, alert.blocks);
        log(`슬랙 끝 알림: ${alert.text}`);
      }),
    setStatus: (key, status, by) => applyAlertStatus(key, status, by, client, log),
    stop: () => stopSocket(),
  };
}

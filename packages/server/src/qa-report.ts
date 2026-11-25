import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { AppConfig } from "@device-farm/core/config/app-config";
import type { FlowDocument } from "@device-farm/core/flows/schema";
import type { AskClaude } from "@device-farm/engine/policy/claude";
import { askReply, isStopRequest, missingTargetPrompt, refinedReply, type MissingTarget, stoppedReply, maxAskRounds, retryPrompt, receivedFollowUpReply, receivedReply, resumedReply, mentionsTarget, opinionPrompt, parseOpinion, parseReportFlow, plainReport, reportPrompt, resultReply, stepsSummary, maxImageBytes, maxReportImages, type KnownFlow, type QaImage, type QaMessage, type ReportApp, type ReportResult } from "@device-farm/engine/qa-report/report";
import type { SlackClient } from "@device-farm/engine/slack/client";

/**
 * 슬랙 QA 채널에 정한 사람·그룹을 태그해 올라온 제보 → Claude가 점검 플로우로 바꾼다 → 바로 기기에서 돌린다 → 원글 스레드에 결과.
 */
export interface QaReportDeps {
  /** 프롬프트에 쓰는 앱 값과 금지 버튼 이름 */
  app: ReportApp & Pick<AppConfig, "guard">;
  client: Pick<SlackClient, "reply" | "uploadImage" | "threadMessages">;
  ask: AskClaude;
  /** 제보 채널(`SLACK_CHANNEL_QA`) */
  channel: string;
  /** 받을 태그의 사람·그룹 id(`SLACK_QA_MENTION_IDS`). 비면 아무 글도 받지 않는다 */
  mentionIds: readonly string[];
  screenMap: () => string;
  /** 확정 플로우. 같은 동작이면 Claude가 그 스텝을 가져다 쓴다(등록 같은 입력 순서는 화면 지도에 없다) */
  knownFlows?: () => readonly KnownFlow[];
  /** 플로우 점검 탭 후보로 남긴다(사람이 확정하면 매일 밤 돈다) */
  saveCandidate: (flow: FlowDocument) => void;
  /** 이 플로우만 대기열에 넣어 돌리고 끝나면 결과 */
  runFlow: (flow: FlowDocument) => Promise<ReportResult>;
  /** 제보 이미지를 받아 로컬 경로로. 없거나 실패하면 글만 본다 */
  downloadImages?: (message: QaMessage) => Promise<string[]>;
  /** 최근 점검에서 기기에 뜬 팝업(경로·제목·버튼) 한 줄씩. 배너 버튼 이름은 코드에 없어 여기서 본다 */
  knownPopups?: () => readonly string[];
  /** 앱 코드 사본을 최신으로 맞추고 경로. Claude가 정상 문구(토스트 등)를 찾는다. 없거나 실패하면 코드 없이 */
  frontSource?: () => Promise<string | null>;
  /** 되물은 스레드 기록. 서버를 다시 켜도 이어 가게 파일에 둔다. 없으면 메모리 */
  pendingStore?: PendingStore;
  /** 실패하면 그 실패를 오류 알림 모양으로 스레드에 달아 「수정 PR 만들기」 버튼을 준다. 없으면 건너뛴다 */
  postFixButton?: (channel: string, threadTs: string, runId: string) => Promise<void>;
  /** 돌고 있는 QA 제보 점검을 멈춘다(「멈춰」 답). 없으면 대기 중인 답만 버린다 */
  stopReport?: () => void;
  /**
   * 정책서 규칙을 글 파일로 쓰고 그 폴더. 정책을 묻는 답(「정책서에는 뭐라 되어있어?」)에 Claude가 Grep으로 찾아 답한다.
   * 없거나 실패하면 정책 없이 답한다
   */
  policyDir?: () => string | null;
  log: (message: string) => void;
}

/** 되물은 스레드: 지금까지 모은 제보 글·이미지·되물은 횟수 */
export interface PendingReport {
  text: string;
  images: string[];
  rounds: number;
  /** 처리하다 서버가 꺼졌다. 다시 켜지면 저절로 이어서 처리한다(`resume`) */
  inProgress?: boolean;
  /** 제보 채널(이어서 처리할 때 답할 곳) */
  channel?: string;
}

export interface PendingStore {
  get: (thread: string) => PendingReport | undefined;
  set: (thread: string, report: PendingReport) => void;
  delete: (thread: string) => void;
  /** 서버가 다시 켜졌을 때 이어 갈 것을 찾는다 */
  entries?: () => [string, PendingReport][];
}

/** 되물은 스레드를 JSON 파일에 둔다(`test-results/qa-reports/pending.json`). 서버를 다시 켜도 답을 이어 받는다 */
export function filePendingStore(file: string): PendingStore {
  const read = (): Record<string, PendingReport> => {
    try {
      return JSON.parse(readFileSync(file, "utf8")) as Record<string, PendingReport>;
    } catch {
      return {};
    }
  };
  const write = (all: Record<string, PendingReport>) => {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(all, null, 2)}\n`);
  };
  return {
    entries: () => Object.entries(read()),
    get: (thread) => read()[thread],
    set: (thread, report) => write({ ...read(), [thread]: report }),
    delete: (thread) => {
      const all = read();
      if (!(thread in all)) return;
      delete all[thread];
      write(all);
    },
  };
}

function memoryPendingStore(): PendingStore {
  const map = new Map<string, PendingReport>();
  return { get: (thread) => map.get(thread), set: (thread, report) => void map.set(thread, report), delete: (thread) => void map.delete(thread) };
}

export type QaReportHandler = ((message: QaMessage) => Promise<void>) & {
  /** 처리하다 서버가 꺼진 제보를 이어서 처리한다(서버를 켤 때 한 번) */
  resume: () => Promise<void>;
};

export function createQaReportHandler(deps: QaReportDeps): QaReportHandler {
  /** 슬랙이 같은 이벤트를 다시 보내도(ack 늦음) 한 번만 */
  const handled = new Set<string>();
  /** 되물은 뒤 답을 기다리는 스레드(원글 ts) */
  const pending = deps.pendingStore ?? memoryPendingStore();
  const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

  /** 지금 처리 중인 스레드 → 그동안 그 스레드에 들어온 답. 끝나면 이어서 반영한다 */
  const active = new Map<string, QaMessage[]>();
  /** 「멈춰」를 받은 스레드. 처리가 끝날 때까지 답을 달지 않는다 */
  const stopped = new Set<string>();

  /**
   * 스레드 댓글에서 태그된 제보: 원글을 본문으로, 사이 댓글은 「스레드 댓글」, 태그한 댓글은 「추가 설명」으로 붙인다. 이미지도 모은다.
   * 댓글 글자만 읽으면 「@담당자 확인 부탁해요」만 보고 무엇을 볼지 모른다. 못 가져오면 댓글만 쓴다
   */
  const withThread = async (message: QaMessage): Promise<QaMessage> => {
    if (!deps.client.threadMessages || !message.threadTs) return message;
    try {
      const raw = await deps.client.threadMessages(message.channel, message.threadTs);
      const thread = raw.flatMap((item) => {
        const parsed = qaMessageOf({ event: { type: "message", ...item, channel: message.channel } });
        return parsed && parsed.ts !== message.ts && Number(parsed.ts) < Number(message.ts) ? [parsed] : [];
      });
      const [root, ...between] = thread;
      if (!root || root.ts !== message.threadTs) return message;
      const text = [root.text, ...between.map((item) => `[스레드 댓글] ${item.text}`), `[추가 설명] ${message.text}`].join("\n\n");
      const images = [...thread, message].flatMap((item) => item.images ?? []).slice(0, maxReportImages);
      deps.log(`QA 제보 스레드 원글 읽음(${message.threadTs}): 댓글 ${between.length}개 · 이미지 ${images.length}장`);
      return { ...message, text, ...(images.length > 0 ? { images } : {}) };
    } catch (error) {
      deps.log(`QA 제보 스레드 원글 읽기 실패(${message.threadTs}): ${errorText(error)}`);
      return message;
    }
  };

  const handle = async (message: QaMessage, resumeText?: PendingReport): Promise<void> => {
    if (message.channel !== deps.channel || handled.has(message.ts)) return;
    const thread = message.threadTs ?? message.ts;
    // 「멈춰」: 처리 중이거나 되물은 스레드면 돌던 점검을 멈추고, 모아 둔 답·되물음 기록을 버린다. 그 뒤 결과 답은 달지 않는다
    if (message.threadTs && isStopRequest(message.text) && (active.has(thread) || pending.get(thread))) {
      handled.add(message.ts);
      const running = active.has(thread);
      if (running) {
        stopped.add(thread);
        active.set(thread, []);
        deps.stopReport?.();
      }
      pending.delete(thread);
      deps.log(`QA 제보 멈춤(${thread})${running ? ": 돌던 점검을 멈춤" : ""}`);
      await deps.client.reply(message.channel, thread, stoppedReply).catch((error: unknown) => deps.log(`QA 제보 멈춤 답 실패(${thread}): ${errorText(error)}`));
      return;
    }
    // 처리 중인 스레드에 단 답은 버리지 않고 모아 둔다
    const waiting = message.threadTs ? active.get(thread) : undefined;
    if (waiting) {
      handled.add(message.ts);
      waiting.push(message);
      deps.log(`QA 제보 처리 중 답 받아 둠(${message.ts}): ${plainReport(message.text).slice(0, 80)}`);
      return;
    }
    const earlier = resumeText ? undefined : message.threadTs ? pending.get(thread) : undefined;
    // 태그한 새 제보, 또는 되물은 스레드에 단 답(태그 없어도), 또는 서버가 다시 켜져 이어 가는 것
    if (!resumeText && !earlier && !mentionsTarget(message.text, deps.mentionIds)) return;
    handled.add(message.ts);
    // 남의 글 스레드 댓글에서 태그했으면 원글(과 사이 댓글·이미지)까지 제보로 읽는다
    if (!resumeText && !earlier && message.threadTs) message = await withThread(message);
    // 처리하는 동안은 「처리 중」으로 남긴다: 서버가 중간에 다시 켜져도 그 스레드의 다음 답을 이어 받는다
    const inFlight: PendingReport = {
      text: resumeText?.text ?? (earlier ? `${earlier.text}\n\n[추가 설명] ${plainReport(message.text)}` : plainReport(message.text)),
      images: resumeText?.images ?? earlier?.images ?? [],
      rounds: resumeText?.rounds ?? earlier?.rounds ?? 0,
      inProgress: true,
      channel: message.channel,
    };
    pending.set(thread, inFlight);
    active.set(thread, []);
    let state: PendingReport | undefined;
    try {
      state = await processReport(message, thread, earlier, resumeText);
    } finally {
      // 끝까지 처리했으면 「처리 중」 표시를 지운다. 되물었으면(askAgain) 새 기록이 남아 있다
      if (pending.get(thread) === inFlight || JSON.stringify(pending.get(thread)) === JSON.stringify(inFlight)) pending.delete(thread);
      const late = stopped.has(thread) ? [] : (active.get(thread) ?? []);
      active.delete(thread);
      if (stopped.delete(thread)) pending.delete(thread);
      if (late.length > 0 && state) {
        // 되묻지 않았어도 이어 간다. 마지막 답 말고는 글만 합치고, 마지막 답으로 다시 처리한다
        const base = pending.get(thread) ?? state;
        const extra = late.slice(0, -1).map((item) => `\n\n[추가 설명] ${plainReport(item.text)}`).join("");
        pending.set(thread, { ...base, text: `${base.text}${extra}` });
        const last = late[late.length - 1];
        handled.delete(last.ts);
        await handle(last);
      }
    }
  };

  /** 제보 하나(또는 추가 설명)를 처리한다. 지금까지 모은 제보 상태를 돌려준다 */
  const processReport = async (message: QaMessage, thread: string, earlier: PendingReport | undefined, resumed?: PendingReport): Promise<PendingReport> => {
    // 「멈춰」 뒤로는 아무것도 달지 않는다
    const reply = async (text: string) => {
      if (!stopped.has(thread)) await deps.client.reply(message.channel, thread, text);
    };
    const added = plainReport(message.text);
    const report = resumed?.text ?? (earlier ? `${earlier.text}\n\n[추가 설명] ${added}` : added);
    const rounds = resumed?.rounds ?? earlier?.rounds ?? 0;
    const canAsk = rounds < maxAskRounds;
    deps.log(`QA 제보 ${earlier ? "추가 설명" : "받음"}(${message.ts}): ${added.slice(0, 80)}`);
    // 플로우 만들기(Claude)가 1~2분 걸린다. 받았다는 답을 먼저 단다
    await reply(resumed ? resumedReply : earlier ? receivedFollowUpReply : receivedReply).catch((error: unknown) => deps.log(`QA 제보 받음 답 실패(${message.ts}): ${errorText(error)}`));
    const fresh = message.images?.length && deps.downloadImages
      ? await deps.downloadImages(message).catch((error: unknown) => {
          deps.log(`QA 제보 이미지 받기 실패(${message.ts}): ${errorText(error)}`);
          return [];
        })
      : [];
    const images = [...(resumed?.images ?? earlier?.images ?? []), ...fresh];
    const current = (): PendingReport => ({ text: report, images, rounds });
    const askAgain = async (question: string) => {
      pending.set(thread, { text: report, images, rounds: rounds + 1 });
      await reply(askReply(question));
    };

    const frontDir = deps.frontSource
      ? await deps.frontSource().catch((error: unknown) => {
          deps.log(`QA 제보 앱 코드 준비 실패(${message.ts}): ${errorText(error)}`);
          return null;
        })
      : null;
    // 앱 코드를 찾게 하면 그 폴더와 디바이스팜 폴더(제보 이미지·스크린샷) 둘 다 읽는다
    const policyDir = deps.policyDir?.() ?? null;
    const dirs = [frontDir, policyDir].filter((dir): dir is string => Boolean(dir));
    const askOptions = (read: boolean) => (dirs.length > 0 ? { searchDirs: dirs } : { allowRead: read });
    let answer: string;
    try {
      answer = await deps.ask(reportPrompt(report, { app: deps.app, screenMap: deps.screenMap(), images, knownFlows: deps.knownFlows?.() ?? [], canAsk, frontDir, knownPopups: deps.knownPopups?.() ?? [], policyDir }), askOptions(images.length > 0));
    } catch (error) {
      await reply(`:memo: 제보를 점검 플로우로 바꾸지 못했어요: ${errorText(error)}`);
      return current();
    }
    /** 버튼을 못 찾은 흐름을 멈춘 화면의 실제 이름으로 한 번 고친다. 못 고치거나 같은 흐름이면 null(첫 결과로 답한다) */
    const refine = async (flow: FlowDocument, missing: MissingTarget): Promise<FlowDocument | null> => {
      deps.log(`QA 제보 버튼을 못 찾아 흐름을 고침(${message.ts}): ${missing.message}`);
      const prompt = reportPrompt(report, { app: deps.app, screenMap: deps.screenMap(), images, knownFlows: deps.knownFlows?.() ?? [], canAsk: false, frontDir, knownPopups: deps.knownPopups?.() ?? [], policyDir }) + missingTargetPrompt(flow, missing);
      const again = await deps.ask(prompt, askOptions(images.length > 0)).catch(() => null);
      const next = again ? parseReportFlow(again, { ts: thread, text: report }, deps.app.guard.forbiddenClickNames) : null;
      if (!next?.ok || JSON.stringify(next.flow.steps) === JSON.stringify(flow.steps)) return null;
      return next.flow;
    };
    let parsed = parseReportFlow(answer, { ts: thread, text: report }, deps.app.guard.forbiddenClickNames);
    // 검증에 걸리면(금지 버튼·형식) 이유를 알려 주고 한 번 더 만든다
    if (!parsed.ok && parsed.invalid) {
      deps.log(`QA 제보 플로우 다시 만듦(${message.ts}): ${parsed.reason}`);
      const prompt = reportPrompt(report, { app: deps.app, screenMap: deps.screenMap(), images, knownFlows: deps.knownFlows?.() ?? [], canAsk, frontDir, knownPopups: deps.knownPopups?.() ?? [], policyDir }) + retryPrompt(answer, parsed.reason);
      const again = await deps.ask(prompt, askOptions(images.length > 0)).catch(() => null);
      if (again) parsed = parseReportFlow(again, { ts: thread, text: report }, deps.app.guard.forbiddenClickNames);
    }
    if (!parsed.ok) {
      // 다시 돌릴 필요 없는 답(인사·앞 결과 질문): 짧게 답하고(빈 글자면 안 답함) 스레드는 그대로 이어 받는다
      if (parsed.reply !== undefined) {
        deps.log(`QA 제보 다시 안 돌림(${message.ts}): ${parsed.reply.slice(0, 80) || "(답 없음)"}`);
        if (parsed.reply) await reply(`:speech_balloon: ${parsed.reply}`);
        if (earlier) pending.set(thread, { text: report, images, rounds });
        return current();
      }
      if (parsed.ask && canAsk) {
        deps.log(`QA 제보 되물음(${message.ts}): ${parsed.ask.slice(0, 80)}`);
        await askAgain(parsed.ask);
        return current();
      }
      deps.log(`QA 제보 플로우 못 만듦(${message.ts}): ${parsed.reason}`);
      await reply(`:memo: 기기 점검 플로우로 바꾸지 않았어요: ${parsed.reason}`);
      return current();
    }
    deps.saveCandidate(parsed.flow);
    await reply(`:robot_face: 이 흐름으로 기기(dev 앱)에서 돌려 볼게요.\n${stepsSummary(parsed.flow.steps)}`);
    let flow = parsed.flow;
    let result: ReportResult;
    try {
      result = await deps.runFlow(flow);
      const refined = result.missing && !stopped.has(thread) ? await refine(flow, result.missing) : null;
      if (refined && !stopped.has(thread)) {
        flow = refined;
        deps.saveCandidate(flow);
        await reply(refinedReply(flow));
        result = await deps.runFlow(flow);
      }
    } catch (error) {
      await reply(`:grey_question: 점검을 시작하지 못했어요: ${errorText(error)}`);
      return current();
    }
    // 의견은 덤이다. Claude가 실패해도 결과는 그대로 단다
    const opinion = await deps
      .ask(opinionPrompt(deps.app, report, flow, result, images, canAsk, frontDir), askOptions(Boolean(result.screenshot) || images.length > 0))
      .then(parseOpinion)
      .catch((error: unknown) => {
        deps.log(`QA 제보 의견 실패(${message.ts}): ${errorText(error)}`);
        return undefined;
      });
    if (stopped.has(thread)) return current();
    await reply(resultReply(result, opinion));
    // 플로우가 끝난 화면(실패면 실패한 화면)을 같은 스레드에 붙인다
    if (result.screenshot) {
      const title = result.status === "failed" ? "실패한 화면" : "플로우를 끝낸 화면";
      try {
        await deps.client.uploadImage(message.channel, thread, readFileSync(result.screenshot), "screen.png", title);
      } catch (error) {
        deps.log(`QA 제보 화면 올리기 실패(${message.ts}): ${errorText(error)}`);
      }
    }
    // 앱을 고쳐야 한다고 볼 때만 「수정 PR 만들기」. 점검 흐름이 틀려 멈춘 실패에 달면 엉뚱한 PR이 생긴다
    if (result.status === "failed" && opinion?.appBug === true && deps.postFixButton) {
      await deps.postFixButton(message.channel, thread, result.runId).catch((error: unknown) => deps.log(`QA 제보 PR 버튼 실패(${message.ts}): ${errorText(error)}`));
    }
    // 결과가 애매하면 무엇이 더 필요한지 묻고, 답이 오면 합쳐서 다시 돌린다
    if (opinion?.ask && canAsk) await askAgain(opinion.ask);
    return current();
  };

  const resume = async () => {
    for (const [thread, entry] of pending.entries?.() ?? []) {
      if (!entry.inProgress || !entry.channel) continue;
      deps.log(`QA 제보 이어서 처리(${thread}): 서버가 처리 중에 다시 켜졌어요`);
      await handle({ channel: entry.channel, text: "", ts: `resume-${thread}-${Date.now()}`, threadTs: thread }, entry).catch((error: unknown) =>
        deps.log(`QA 제보 이어서 처리 실패(${thread}): ${errorText(error)}`),
      );
    }
  };

  return Object.assign((message: QaMessage) => handle(message), { resume });
}

/** 파일을 붙인 글은 subtype이 `file_share`다. 그 밖의 subtype(수정·삭제·참여 알림)은 뺀다 */
const acceptedSubtypes = new Set([undefined, "file_share"]);

/** Socket Mode `events_api` 봉투의 메시지 이벤트 → 제보 후보. 봇·수정·삭제·참여 알림은 뺀다. 이미지만 골라 담는다 */
export function qaMessageOf(payload: unknown): QaMessage | null {
  const event = (payload as { event?: Record<string, unknown> } | undefined)?.event;
  if (!event || event.type !== "message" || !acceptedSubtypes.has(event.subtype as string | undefined) || event.bot_id) return null;
  const { channel, text, ts, user, thread_ts: threadTs } = event;
  if (typeof channel !== "string" || typeof text !== "string" || typeof ts !== "string") return null;
  const images = (Array.isArray(event.files) ? (event.files as Record<string, unknown>[]) : []).flatMap((file): QaImage[] => {
    const url = file.url_private_download ?? file.url_private;
    if (typeof file.mimetype !== "string" || !file.mimetype.startsWith("image/") || typeof url !== "string") return [];
    return [{ name: typeof file.name === "string" ? file.name : "image", mimetype: file.mimetype, url }];
  });
  return {
    channel,
    text,
    ts,
    ...(typeof user === "string" ? { user } : {}),
    ...(typeof threadTs === "string" ? { threadTs } : {}),
    ...(images.length > 0 ? { images: images.slice(0, maxReportImages) } : {}),
  };
}

/** 슬랙 비공개 파일 주소인지. 봇 토큰을 다른 곳으로 보내지 않는다 */
export function isSlackFileUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && (parsed.hostname === "files.slack.com" || parsed.hostname.endsWith(".slack.com"));
  } catch {
    return false;
  }
}

/** 제보 이미지를 `dir`에 받는다(봇 토큰, `files:read`). 슬랙 주소·이미지·크기 한도만. 받은 파일 경로 */
export async function downloadReportImages(
  images: readonly QaImage[],
  dir: string,
  token: string,
  fetchImpl: (url: string, init: { headers: Record<string, string> }) => Promise<{ ok: boolean; status: number; headers: { get(name: string): string | null }; arrayBuffer(): Promise<ArrayBuffer> }> = (url, init) => fetch(url, init),
): Promise<string[]> {
  const saved: string[] = [];
  for (const [index, image] of images.slice(0, maxReportImages).entries()) {
    if (!isSlackFileUrl(image.url)) continue;
    const response = await fetchImpl(image.url, { headers: { Authorization: `Bearer ${token}` } });
    // 권한이 없으면 슬랙은 200으로 로그인 HTML을 준다. 이미지가 아니면 버린다
    const type = response.headers.get("content-type") ?? "";
    if (!response.ok || !type.startsWith("image/")) throw new Error(`이미지를 받지 못했어요(${response.status} ${type || "형식 모름"}). 봇에 files:read 권한이 있는지 확인해 주세요.`);
    const body = Buffer.from(await response.arrayBuffer());
    if (body.length > maxImageBytes) continue;
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${index + 1}.${image.mimetype.split("/")[1]?.replace(/[^a-z0-9]/gi, "") || "png"}`);
    writeFileSync(file, body);
    saved.push(file);
  }
  return saved;
}

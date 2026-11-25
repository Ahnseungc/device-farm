import { canStartFix, type FixableAlert, type FixPrInfo } from "@device-farm/core/slack/fix-pr";
import { plainError } from "@device-farm/core/slack/plain-error";
import type { FixPrRunner } from "@device-farm/engine/fix-pr/fix-pr";
import type { SentAlert } from "@device-farm/engine/slack/alert-store";
import type { SlackClient } from "@device-farm/engine/slack/client";

/**
 * 오류 알림의 「수정 PR 만들기」 버튼(packages/engine/src/fix-pr/specs/README.md).
 * 한 번에 하나씩 돌린다(레포 사본이 하나). 진행은 알림 기록 `fix`에 남기고 슬랙 메시지·스레드를 고친다.
 */

export interface FixPrButtonDeps {
  client: SlackClient;
  runner: FixPrRunner;
  readAlerts: () => Record<string, SentAlert>;
  saveAlert: (key: string, sent: SentAlert) => void;
  /** 같은 모양으로 메시지를 다시 그린다 */
  render: (sent: SentAlert) => { text: string; blocks: unknown[] };
  log: (message: string) => void;
  now?: () => Date;
}

const isFixable = (alert: SentAlert["alert"]): alert is FixableAlert => "type" in alert && (alert.type === "failure" || alert.type === "design");

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export interface FixPrButton {
  /** 버튼을 누르면. 돌리기 시작했으면(또는 거절 답을 했으면) 끝까지 기다린다 */
  start: (key: string, by: string | undefined) => Promise<void>;
  /** 서버가 다시 켜질 때 `running`으로 남은 것을 `failed`로 */
  recover: () => Promise<void>;
  /** 돌고 있거나 기다리는 수정이 있는지 */
  busy: () => boolean;
}

export function createFixPrButton(deps: FixPrButtonDeps): FixPrButton {
  const now = () => (deps.now?.() ?? new Date()).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
  let queue: Promise<void> = Promise.resolve();
  let pending = 0;

  const setFix = async (key: string, fix: FixPrInfo): Promise<SentAlert | null> => {
    const sent = deps.readAlerts()[key];
    if (!sent) return null;
    const updated = { ...sent, fix };
    deps.saveAlert(key, updated);
    if (sent.ts) {
      const { text, blocks } = deps.render(updated);
      await deps.client.update(sent.channel, sent.ts, text, blocks).catch((error: unknown) => deps.log(`수정 PR 메시지 고치기 실패: ${message(error)}`));
    }
    return updated;
  };

  const reply = async (sent: SentAlert, text: string) => {
    if (!sent.ts) return;
    await deps.client.reply(sent.channel, sent.threadTs ?? sent.ts, text).catch((error: unknown) => deps.log(`수정 PR 스레드 답 실패: ${message(error)}`));
  };

  const run = async (key: string, alert: FixableAlert, by: string | undefined) => {
    let fix: FixPrInfo;
    let text: string;
    try {
      const result = await deps.runner(alert);
      if (result.state === "opened") {
        const note = result.skipped.map((skip) => skip.reason).join(", ") || undefined;
        fix = { state: "opened", by, at: now(), prs: result.prs, ...(note ? { note } : {}) };
        text = [`:white_check_mark: 수정 PR을 열었어요: ${result.prs.map((pr) => `<${pr.url}|${pr.base} #${pr.number}>`).join(" · ")}`, ...(note ? [`건너뜀: ${note}`] : []), "", result.summary].join("\n");
      } else {
        fix = { state: "no-change", by, at: now(), category: result.category, note: result.summary.split("\n")[0] || "고칠 곳을 못 찾았어요" };
        const why = result.category === "farm" ? "앱은 맞고 디바이스팜 점검기 오탐으로 보여요" : result.category === "server" ? "서버·데이터·기기 쪽 문제로 보여요" : "고칠 곳을 못 찾았어요";
        text = `:warning: ${why}. PR을 만들지 않았어요.\n\n${result.summary || "-"}`;
      }
    } catch (error) {
      // 슬랙에는 풀어 쓴 한국어, 서버 로그에는 원문
      fix = { state: "failed", by, at: now(), note: plainError(message(error)) };
      text = `:x: 수정 PR을 만들지 못했어요. ${plainError(message(error))}`;
      deps.log(`수정 PR 실패(${alert.path}): ${message(error)}`);
    }
    const sent = await setFix(key, fix);
    if (sent) await reply(sent, text);
  };

  return {
    start: async (key, by) => {
      const sent = deps.readAlerts()[key];
      if (!sent || !isFixable(sent.alert)) {
        deps.log(`수정 PR 버튼: 모르는 알림 ${key}`);
        return;
      }
      if (!canStartFix(sent.fix)) {
        await reply(sent, sent.fix?.state === "running" ? "이미 수정 PR을 만들고 있어요." : "이미 수정 PR이 열려 있어요.");
        return;
      }
      const alert = sent.alert;
      const started = await setFix(key, { state: "running", by, at: now() });
      if (started) await reply(started, `${by ? `<@${by}> ` : ""}수정 PR 만드는 중이에요(최대 15분). 앞에 다른 수정이 있으면 끝난 뒤 시작해요.`);
      deps.log(`수정 PR 시작: ${alert.path}`);
      pending++;
      queue = queue.then(() => run(key, alert, by)).finally(() => {
        pending--;
      });
      await queue;
    },
    busy: () => pending > 0,
    recover: async () => {
      for (const [key, sent] of Object.entries(deps.readAlerts())) {
        if (sent.fix?.state === "running") await setFix(key, { ...sent.fix, state: "failed", note: "서버가 다시 켜져 멈췄어요" });
      }
    },
  };
}

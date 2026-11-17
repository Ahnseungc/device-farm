import { nightlyDecision, nightlySlots, type NightlyKind, type NightlySlot } from "@device-farm/core/nightly/schedule";
import { readNightly, writeNightly, type NightlyRecord } from "@device-farm/engine/nightly-store";

/** 예정 시각이 지났는지 보는 간격 (작성자 판단). 앞 작업이 바쁘면 이 간격으로 다시 본다 */
export const nightlyPollMs = 5 * 60_000;

/** 칸을 시작해 보고 결과를 돌려준다. 바쁘면(다른 점검·사람 조작) `busy`와 이유 */
export type NightlyStart = { started: true; note: string } | { started: false; busy: string };

export interface NightlyDeps {
  start: (slot: NightlySlot, scheduledAt: Date) => NightlyStart;
  log: (message: string) => void;
  now?: () => Date;
  read?: (kind: NightlyKind) => NightlyRecord | null;
  write?: (kind: NightlyKind, record: NightlyRecord) => void;
}

/**
 * 야간 플로우 점검·봇 점검을 정해진 시각에 돌린다(docs/operations.md). 정책 감시처럼 서버 안 타이머로 돈다.
 * 다른 작업이 돌고 있으면 다음 확인 때 다시 시도하고, 창(nightlyWindowMs)이 지나면 그날은 건너뛴 것으로 남긴다.
 */
export function startNightlyChecks(deps: NightlyDeps): { tick: () => void; stop: () => void } {
  const now = deps.now ?? (() => new Date());
  const read = deps.read ?? ((kind) => readNightly(kind));
  const write = deps.write ?? ((kind, record) => writeNightly(kind, record));
  /** 같은 칸에서 「바쁨」을 매번 찍지 않게 이유가 바뀔 때만 남긴다 */
  const lastBusy = new Map<NightlyKind, string>();

  const handle = (slot: NightlySlot) => {
    const current = now();
    const decision = nightlyDecision(slot, read(slot.kind)?.scheduledAt ?? null, current);
    if (decision.action === "wait") return;
    const record = (result: NightlyRecord["result"], note: string) =>
      write(slot.kind, { scheduledAt: decision.scheduledAt.toISOString(), result, note, at: current.toISOString() });
    if (decision.action === "skip") {
      record("skipped", lastBusy.get(slot.kind) ?? "서버가 그 시각에 꺼져 있었음");
      deps.log(`${slot.label} 건너뜀: ${lastBusy.get(slot.kind) ?? "예정 시각에 서버가 꺼져 있었음"}`);
      lastBusy.delete(slot.kind);
      return;
    }
    const started = deps.start(slot, decision.scheduledAt);
    if (!started.started) {
      if (lastBusy.get(slot.kind) !== started.busy) deps.log(`${slot.label} 대기: ${started.busy}`);
      lastBusy.set(slot.kind, started.busy);
      return;
    }
    record("started", started.note);
    lastBusy.delete(slot.kind);
    deps.log(`${slot.label} 시작 (${started.note})`);
  };

  const tick = () => {
    for (const slot of nightlySlots) {
      try {
        handle(slot);
      } catch (error) {
        deps.log(`${slot.label} 확인 실패: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  };
  tick();
  const timer = setInterval(tick, nightlyPollMs);
  return { tick, stop: () => clearInterval(timer) };
}

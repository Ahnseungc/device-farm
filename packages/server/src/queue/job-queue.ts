import { randomBytes } from "node:crypto";

export const jobKinds = ["run", "explore", "replay", "bot"] as const;
export type JobKind = (typeof jobKinds)[number];

/** 누가 넣었나: 사람(웹·CLI), 야간 스케줄, 새 빌드 자동 점검, 슬랙 수정(고친 시나리오 다시 돌리기) */
export const jobSources = ["manual", "nightly", "auto", "fix"] as const;
export type JobSource = (typeof jobSources)[number];

export const busyMessages = {
  run: "이미 기기 점검 중입니다.",
  explore: "이미 탐색 중입니다.",
  replay: "다시 돌리기가 진행 중입니다.",
  bot: "봇 점검 중입니다.",
} as const satisfies Record<JobKind, string>;

/** 대기열에 둘 수 있는 작업 수 (작성자 판단) */
export const maxQueuedJobs = 20;
export const queueFullMessage = `대기열이 꽉 찼어요(${maxQueuedJobs}개). 앞의 점검이 끝난 뒤 다시 넣어 주세요.`;
export const notQueuedMessage = "대기열에 없는 작업이에요. 이미 시작했거나 빠졌어요.";
/** 다시 돌리기는 결과를 바로 기다리므로 대기열에 넣지 않는다 */
export const replayBusyMessage = "다른 점검이 돌거나 기다리는 중이라 지금은 다시 돌릴 수 없어요.";

export type JobEnd = "finished" | "failed" | "canceled";

/** 대기열 한 칸(웹 GET /api/devices/queue) */
export interface QueuedJob {
  id: string;
  kind: JobKind;
  label: string;
  source: JobSource;
  /** 실행 id(기기 점검·탐색) 또는 시드(봇). 결과 화면에서 찾는 데 쓴다 */
  ref?: string;
  queuedAt: string;
}

export interface JobQueueState {
  running: (QueuedJob & { startedAt: string }) | null;
  pending: QueuedJob[];
}

export interface EnqueueInput {
  kind: Exclude<JobKind, "replay">;
  label: string;
  source: JobSource;
  ref?: string;
  /** 차례가 오면 부른다. 동기 부분(멈추기 핸들 등록)은 시작 순간에 돈다 */
  work: () => Promise<unknown>;
  /** true면 맨 앞(다른 급한 것 뒤)에 서고, 도는 작업을 멈춰 세운다(QA 제보 점검) */
  urgent?: boolean;
  /**
   * 급한 작업이 들어와 이 작업을 멈출 때 부른다. 멈추기(abort)를 걸고, 멈춘 곳부터 이어 갈 작업을 돌려준다.
   * 없으면 멈추지 않는다(끝날 때까지 기다린다). null을 돌려줘도 그렇다(이미 멈추는 중 등)
   */
  interrupt?: () => EnqueueInput | null;
}

/** position 0이면 바로 시작, n이면 대기 n번째. done은 reject하지 않는다 */
export type EnqueueResult = { ok: true; id: string; position: number; done: Promise<JobEnd> } | { ok: false; error: string };

interface Entry extends QueuedJob {
  work: () => Promise<unknown>;
  urgent: boolean;
  interrupt?: () => EnqueueInput | null;
  /** 이미 급한 작업에 밀려 멈추는 중 */
  interrupted?: boolean;
  settle: (end: JobEnd) => void;
  done: Promise<JobEnd>;
}

export interface JobQueueDeps {
  /** 작업 하나가 끝날 때마다(성공·실패) */
  onJobEnd: () => void;
  log: (message: string) => void;
  now?: () => Date;
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * 서버 전체에 작업 하나만 돈다. 바쁘면 막지 않고 뒤에 쌓았다가 앞의 것이 끝나면 들어온 순서대로 돌린다.
 */
export function createJobQueue(deps: JobQueueDeps) {
  const now = deps.now ?? (() => new Date());
  let current: (Entry & { startedAt: string }) | { kind: "replay"; startedAt: string } | null = null;
  const pending: Entry[] = [];

  function next(): void {
    current = null;
    const entry = pending.shift();
    if (entry) begin(entry);
  }

  function begin(entry: Entry): void {
    // 복사하지 않는다: 멈춤 표시(`interrupted`)를 아래 끝 처리와 같은 객체에 남긴다
    current = Object.assign(entry, { startedAt: now().toISOString() });
    // async IIFE: work()의 동기 부분은 여기서 바로 돈다
    void (async () => {
      let end: JobEnd = "finished";
      try {
        await entry.work();
      } catch (error) {
        end = "failed";
        deps.log(`${entry.label} 실패: ${errorText(error)}`);
      }
      next();
      try {
        deps.onJobEnd();
      } catch (error) {
        deps.log(`작업 뒤 정리 실패: ${errorText(error)}`);
      }
      // 급한 작업에 밀려 멈췄으면 이어 간 작업이 끝날 때 끝난 것으로 본다(기다리는 쪽: 자동 점검·다시 돌려 보기)
      if (!entry.interrupted) entry.settle(end);
    })();
  }

  function makeEntry(input: EnqueueInput): Entry {
    let settle: (end: JobEnd) => void = () => {};
    const done = new Promise<JobEnd>((resolve) => {
      settle = resolve;
    });
    return {
      id: `q-${randomBytes(4).toString("hex")}`,
      kind: input.kind,
      label: input.label,
      source: input.source,
      ...(input.ref === undefined ? {} : { ref: input.ref }),
      queuedAt: now().toISOString(),
      work: input.work,
      urgent: input.urgent === true,
      ...(input.interrupt ? { interrupt: input.interrupt } : {}),
      settle,
      done,
    };
  }

  function enqueue(input: EnqueueInput): EnqueueResult {
    // 급한 작업은 꽉 차도 받는다
    if (!input.urgent && pending.length >= maxQueuedJobs) return { ok: false, error: queueFullMessage };
    const entry = makeEntry(input);
    if (current === null) {
      begin(entry);
      return { ok: true, id: entry.id, position: 0, done: entry.done };
    }
    if (!entry.urgent) {
      pending.push(entry);
      deps.log(`${entry.label} 대기 ${pending.length}번째`);
      return { ok: true, id: entry.id, position: pending.length, done: entry.done };
    }
    // 급한 작업: 앞의 급한 것들 바로 뒤에 선다
    const at = pending.findIndex((item) => !item.urgent);
    const index = at < 0 ? pending.length : at;
    pending.splice(index, 0, entry);
    // 도는 작업이 급하지 않으면 멈추고, 멈춘 곳부터 이어 갈 작업을 급한 것 바로 뒤에 세운다
    const running = current && "id" in current ? current : null;
    if (running && !running.urgent && !running.interrupted && running.interrupt) {
      const resume = running.interrupt();
      if (resume) {
        running.interrupted = true;
        const continued = makeEntry(resume);
        void continued.done.then(running.settle);
        const after = pending.findIndex((item) => !item.urgent);
        pending.splice(after < 0 ? pending.length : after, 0, continued);
        deps.log(`${entry.label}: 급한 작업이라 ${running.label}을(를) 멈추고 먼저 돌린 뒤 이어서 돌려요`);
      }
    }
    deps.log(`${entry.label} 대기 ${index + 1}번째(급함)`);
    return { ok: true, id: entry.id, position: index + 1, done: entry.done };
  }

  /** 대기열을 건너뛰지 않는 즉시 작업(다시 돌리기). 도는 것도 기다리는 것도 없을 때만 돈다. 실패는 그대로 reject */
  function startNow(work: () => Promise<unknown>): Promise<void> | null {
    if (current !== null || pending.length > 0) return null;
    current = { kind: "replay", startedAt: now().toISOString() };
    return (async () => {
      try {
        await work();
      } finally {
        next();
        deps.onJobEnd();
      }
    })();
  }

  function cancel(id: string): boolean {
    const index = pending.findIndex((entry) => entry.id === id);
    if (index < 0) return false;
    const [entry] = pending.splice(index, 1);
    deps.log(`${entry.label} 대기 취소`);
    entry.settle("canceled");
    return true;
  }

  const view = ({ id, kind, label, source, ref, queuedAt }: QueuedJob): QueuedJob => ({ id, kind, label, source, ...(ref === undefined ? {} : { ref }), queuedAt });

  function state(): JobQueueState {
    const running = current && "id" in current ? { ...view(current), startedAt: current.startedAt } : null;
    return { running, pending: pending.map(view) };
  }

  return {
    enqueue,
    startNow,
    cancel,
    state,
    isBusy: () => current !== null,
    busyMessage: () => (current === null ? "" : busyMessages[current.kind]),
  };
}

export type JobQueue = ReturnType<typeof createJobQueue>;

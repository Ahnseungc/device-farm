import { setTimeout as wait } from "node:timers/promises";

export const jobKinds = ["run", "explore", "replay"] as const;
export type JobKind = (typeof jobKinds)[number];

export const busyMessages = {
  run: "이미 기기 점검 중입니다.",
  explore: "이미 탐색 중입니다.",
  replay: "다시 돌리기가 진행 중입니다.",
} as const satisfies Record<JobKind, string>;

/** 자동 점검이 수동 작업이 끝나길 기다릴 때 확인 주기 (작성자 판단) */
export const idlePollMs = 1_000;

/** 기기 점검·탐색·다시 돌리기 중 하나만 돈다. 끝나면 onIdle. */
export function createJobGate(onIdle: () => void) {
  let current: JobKind | null = null;

  /** 비어 있으면 잡고 work를 돌린다. 바쁘면 null. 돌려준 Promise는 work의 실패를 그대로 reject한다. */
  function start(kind: JobKind, work: () => Promise<unknown>): Promise<void> | null {
    if (current !== null) return null;
    current = kind;
    return (async () => {
      try {
        await work();
      } finally {
        current = null;
        onIdle();
      }
    })();
  }

  /** 자동 점검용. 409 대신 비기를 기다렸다가 돈다. */
  async function startWhenIdle(kind: JobKind, work: () => Promise<unknown>): Promise<void> {
    for (;;) {
      const started = start(kind, work);
      if (started) return started;
      await wait(idlePollMs);
    }
  }

  return {
    start,
    startWhenIdle,
    isBusy: () => current !== null,
    busyMessage: () => (current === null ? "" : busyMessages[current]),
  };
}

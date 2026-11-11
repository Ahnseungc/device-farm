export type LockOwner = { kind: "bot"; runId: string } | { kind: "user"; user: string };

/** 사람 잠금이 입력 없이 풀리기까지 (작성자 판단) */
export const controlIdleMs = 5 * 60_000;

type LockEntry = { owner: LockOwner; touchedAt: number };

function sameOwner(left: LockOwner, right: LockOwner): boolean {
  if (left.kind === "bot" && right.kind === "bot") return left.runId === right.runId;
  if (left.kind === "user" && right.kind === "user") return left.user === right.user;
  return false;
}

/** 기기 하나를 한 주체만 쓰게 한다. 메모리에만 있다. */
export class DeviceLocks {
  private entries = new Map<string, LockEntry>();

  constructor(private readonly now: () => number = Date.now) {}

  acquire(id: string, owner: LockOwner): boolean {
    const current = this.ownerOf(id);
    if (current && !sameOwner(current, owner)) return false;
    this.entries.set(id, { owner, touchedAt: this.now() });
    return true;
  }

  release(id: string, owner: LockOwner): void {
    const current = this.ownerOf(id);
    if (current && sameOwner(current, owner)) this.entries.delete(id);
  }

  touch(id: string): void {
    const entry = this.entries.get(id);
    if (entry) entry.touchedAt = this.now();
  }

  ownerOf(id: string): LockOwner | null {
    const entry = this.entries.get(id);
    if (!entry) return null;
    const idle = entry.owner.kind === "user" && this.now() - entry.touchedAt > controlIdleMs;
    if (!idle) return entry.owner;
    this.entries.delete(id);
    return null;
  }
}

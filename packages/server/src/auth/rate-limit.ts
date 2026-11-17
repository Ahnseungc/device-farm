/** 접속 IP마다 10분 안에 5번 틀리면 15분 잠금. 메모리에만 둔다(재시작하면 풀린다). */
export const loginFailLimit = 5;
export const loginFailWindowMs = 10 * 60 * 1000;
export const loginLockMs = 15 * 60 * 1000;

interface Entry {
  fails: number[];
  lockedUntil: number;
}

export class LoginLimiter {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly limit = loginFailLimit,
    private readonly windowMs = loginFailWindowMs,
    private readonly lockMs = loginLockMs,
  ) {}

  /** 잠겨 있으면 남은 ms, 아니면 0 */
  lockedFor(ip: string, now = Date.now()): number {
    const entry = this.entries.get(ip);
    if (!entry) return 0;
    if (entry.lockedUntil > now) return entry.lockedUntil - now;
    if (entry.lockedUntil) this.entries.delete(ip);
    return 0;
  }

  /** 실패를 적는다. 이번 실패로 잠겼으면 locked true */
  fail(ip: string, now = Date.now()): { count: number; locked: boolean } {
    const entry = this.entries.get(ip) ?? { fails: [], lockedUntil: 0 };
    entry.fails = entry.fails.filter((at) => now - at < this.windowMs);
    entry.fails.push(now);
    const count = entry.fails.length;
    const locked = count >= this.limit;
    if (locked) {
      entry.lockedUntil = now + this.lockMs;
      entry.fails = [];
    }
    this.entries.set(ip, entry);
    return { count, locked };
  }

  succeed(ip: string): void {
    this.entries.delete(ip);
  }
}

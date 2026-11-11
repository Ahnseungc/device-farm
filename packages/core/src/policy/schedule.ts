/**
 * 정책 바뀜 감지 일정. 매일 이 시각(서버 로컬 시간)에 한 번 돈다. 밤 점검 전 (작성자 판단).
 * 서버가 그 시각에 꺼져 있었어도, 켜졌을 때 그 뒤로 확인한 기록이 없으면 바로 돈다.
 */
export const policyCheckHour = 2;

/** now 기준 가장 최근의 예정 시각(오늘 2시가 아직이면 어제 2시) */
export function lastScheduledAt(now: Date, hour = policyCheckHour): Date {
  const scheduled = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, 0, 0, 0);
  if (scheduled.getTime() > now.getTime()) scheduled.setDate(scheduled.getDate() - 1);
  return scheduled;
}

export function nextScheduledAt(now: Date, hour = policyCheckHour): Date {
  const next = lastScheduledAt(now, hour);
  next.setDate(next.getDate() + 1);
  return next;
}

/** 마지막 확인이 가장 최근 예정 시각보다 앞이면(또는 없으면) 돌 때다. */
export function isPolicyCheckDue(lastCheckedAt: string | null | undefined, now: Date, hour = policyCheckHour): boolean {
  const last = lastCheckedAt ? Date.parse(lastCheckedAt) : Number.NaN;
  return !Number.isFinite(last) || last < lastScheduledAt(now, hour).getTime();
}

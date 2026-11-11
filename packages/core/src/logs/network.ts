/**
 * 네트워크 로그 한 줄 형식. 수집기(collect.ts)가 쓰고 탐색 probe가 읽는다.
 * `METHOD STATUS URL[ 사유]`. 요청이 실패해 상태가 없으면 STATUS는 0, 메서드를 모르면 UNKNOWN.
 */
export function formatNetworkLog(method: string, status: number, url: string, reason = ""): string {
  return [method.toUpperCase(), String(status), url, reason].filter(Boolean).join(" ").trim();
}

const networkLogLine = /^([A-Za-z]+) (\d{1,3}) (\S+)(?: .*)?$/;

export function parseNetworkLog(text: string): { method: string; status: number; url: string } | null {
  const match = networkLogLine.exec(text.trim());
  if (!match) return null;
  return { method: match[1].toUpperCase(), status: Number(match[2]), url: match[3] };
}

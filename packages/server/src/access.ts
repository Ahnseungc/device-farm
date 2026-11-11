import type { IncomingHttpHeaders } from "node:http";

/**
 * 디바이스팜 접근 판단. 실시간 화면에 실제 계정 자산이 보이고 원격 조작이 되므로 tailnet 안이라도 계정을 본다.
 * - 밖에서는 `tailscale serve`로만 들어온다. serve가 접속한 사람 계정을 `Tailscale-User-Login`에 붙이고,
 *   클라이언트가 보낸 같은 이름 헤더는 덮어쓴다. 서버는 127.0.0.1에만 열려 serve를 건너뛸 길이 없다.
 * - 계정 도메인이 허용 목록(`FARM_ALLOWED_DOMAINS`, 비면 앱 설정 `access.allowedDomains`)에 있으면 들어온다.
 *   목록이 비면 계정으로는 아무도 못 들어온다(호스트 맥 로컬 접속만).
 * - 계정 헤더도 프록시 흔적도 없는 127.0.0.1 요청은 호스트 맥에서 직접 연 것(SSH CLI 포함)이라 들어온다.
 */
export const localUser = "local";

const userHeader = "tailscale-user-login";
const proxyHeaders = ["x-forwarded-for", "x-forwarded-host", "forwarded", "tailscale-user-name"] as const;
const loopbackAddresses = ["127.0.0.1", "::1", "::ffff:127.0.0.1"] as const;

export type Access = { ok: true; user: string } | { ok: false; status: 401 | 403; message: string };

export interface AccessInput {
  remoteAddress?: string;
  headers: IncomingHttpHeaders;
}

/** `FARM_ALLOWED_DOMAINS=example.com,example.org` 쉼표 목록. 비면 fallback(앱 설정). */
export function allowedDomains(value = process.env.FARM_ALLOWED_DOMAINS, fallback: readonly string[] = []): string[] {
  const normalize = (list: readonly string[]) => list.map((domain) => domain.trim().toLowerCase().replace(/^@/, "")).filter(Boolean);
  const domains = normalize((value ?? "").split(","));
  return domains.length > 0 ? domains : normalize(fallback);
}

function headerValue(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name];
  return (Array.isArray(value) ? value[0] : value)?.trim() || undefined;
}

function domainOf(login: string): string {
  return (login.split("@").at(-1) ?? "").toLowerCase();
}

export function decideAccess(input: AccessInput, domains: readonly string[]): Access {
  const login = headerValue(input.headers, userHeader);
  if (login) {
    if (login.includes("@") && domains.includes(domainOf(login))) return { ok: true, user: login };
    const allowed = domains.length > 0 ? `${domains.join(", ")} 계정으로 접속해 주세요.` : "허용한 계정 도메인이 없습니다(FARM_ALLOWED_DOMAINS·access.allowedDomains).";
    return { ok: false, status: 403, message: `${login} 계정은 디바이스팜을 쓸 수 없습니다. ${allowed}` };
  }
  const proxied = proxyHeaders.some((name) => headerValue(input.headers, name));
  const loopback = loopbackAddresses.some((address) => address === input.remoteAddress);
  if (loopback && !proxied) return { ok: true, user: localUser };
  return { ok: false, status: 401, message: "Tailscale 계정을 확인할 수 없습니다. tailnet 안에서 tailscale serve 주소로 접속해 주세요." };
}

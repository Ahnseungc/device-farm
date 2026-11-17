/** GitHub REST — 수정 PR 토큰(`FARM_FIX_PR_GITHUB_TOKEN`)으로 사용자 확인·PR 열기만 한다 */

export type GithubFetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export class GithubError extends Error {}

export interface GithubUser {
  login: string;
  id: number;
}

export interface Github {
  user: () => Promise<GithubUser>;
  createPull: (repo: string, pull: { head: string; base: string; title: string; body: string }) => Promise<{ number: number; url: string }>;
}

export function createGithub(token: string, fetchImpl: GithubFetch = (url, init) => fetch(url, init)): Github {
  const call = async (method: string, path: string, body?: unknown): Promise<Record<string, unknown>> => {
    const response = await fetchImpl(`https://api.github.com${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "device-farm",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      const errors = Array.isArray(data.errors) ? ` (${(data.errors as { message?: string }[]).map((error) => error.message ?? "").join(", ")})` : "";
      throw new GithubError(`GitHub ${method} ${path} ${response.status}: ${String(data.message ?? "")}${errors}`);
    }
    return data;
  };
  return {
    user: async () => {
      const data = await call("GET", "/user");
      return { login: String(data.login), id: Number(data.id) };
    },
    createPull: async (repo, pull) => {
      const data = await call("POST", `/repos/${repo}/pulls`, pull);
      return { number: Number(data.number), url: String(data.html_url) };
    },
  };
}

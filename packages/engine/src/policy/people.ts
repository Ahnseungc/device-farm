import type { ConfluenceConfig, FetchLike } from "./confluence";

/**
 * 정책서 작성자. Confluence는 이메일을 숨겨서(2026-11-12 확인) 이름으로 슬랙 계정을 찾는다.
 * 페이지 담당자(ownerId)를 먼저, 없으면 만든 사람(authorId)을 쓴다.
 */
export async function readPageOwnerName(config: ConfluenceConfig, pageId: string, fetchImpl: FetchLike): Promise<string | null> {
  const headers = { Authorization: `Basic ${Buffer.from(`${config.email}:${config.token}`).toString("base64")}`, Accept: "application/json" };
  const base = `https://api.atlassian.com/ex/confluence/${config.cloudId}/wiki`;
  const page = (await (await fetchImpl(`${base}/api/v2/pages/${encodeURIComponent(pageId)}`, { headers })).json()) as { ownerId?: string; authorId?: string };
  const accountId = page.ownerId ?? page.authorId;
  if (!accountId) return null;
  const user = (await (await fetchImpl(`${base}/rest/api/user?accountId=${encodeURIComponent(accountId)}`, { headers })).json()) as { displayName?: string; publicName?: string };
  return user.displayName ?? user.publicName ?? null;
}

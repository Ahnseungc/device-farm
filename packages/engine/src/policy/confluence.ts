import { createHash } from "node:crypto";

import type { ConfluencePolicySource } from "@device-farm/core/config/app-config";
import type { PolicyPage, PolicySnapshot } from "@device-farm/core/policy/snapshot";

/**
 * Confluence 정책 문서 읽기(docs/design-policy-figma.md). 읽기 전용 범위 지정 API 토큰을 쓴다.
 * 범위 지정 토큰은 사이트 주소로 부르면 403이라 api.atlassian.com 게이트웨이로 부른다.
 * cloudId·스페이스·제목 규칙·위키 주소는 앱 설정 `policy.confluence`(또는 CONFLUENCE_* 환경 변수)에서 받는다.
 */

/** 제목 규칙 기본값 */
export const defaultPolicyTitleQuery = "정책";
/** 검색 한 번에 받을 수 (Confluence 상한 안, 작성자 판단) */
const searchPageSize = 50;
/** 본문을 동시에 받을 수 (작성자 판단) */
const pageConcurrency = 5;

export interface ConfluenceConfig {
  email: string;
  token: string;
  cloudId: string;
  spaceKey: string;
  titleQuery: string;
  /** 사람이 열어 볼 위키 주소(`https://<site>.atlassian.net/wiki`). 비면 게이트웨이 주소 */
  siteUrl: string;
}

export type FetchLike = (url: string, init: { headers: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** 토큰은 환경 변수, 어디를 읽을지는 앱 설정. 토큰이나 cloudId·스페이스가 없으면 null(정책 대조를 끈다) */
export function confluenceConfigFromEnv(source: Partial<ConfluencePolicySource> | undefined, env: NodeJS.ProcessEnv = process.env): ConfluenceConfig | null {
  const email = env.CONFLUENCE_EMAIL?.trim();
  const token = env.CONFLUENCE_API_TOKEN?.trim();
  const cloudId = env.CONFLUENCE_CLOUD_ID?.trim() || source?.cloudId;
  const spaceKey = env.CONFLUENCE_SPACE_KEY?.trim() || source?.spaceKey;
  if (!email || !token || !cloudId || !spaceKey) return null;
  return { email, token, cloudId, spaceKey, titleQuery: source?.titleQuery || defaultPolicyTitleQuery, siteUrl: (source?.siteUrl ?? "").replace(/\/+$/, "") };
}

const wikiBase = (config: ConfluenceConfig) => `https://api.atlassian.com/ex/confluence/${config.cloudId}/wiki`;

export class ConfluenceError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function getJson<T>(config: ConfluenceConfig, pathAndQuery: string, fetchImpl: FetchLike): Promise<T> {
  const auth = Buffer.from(`${config.email}:${config.token}`).toString("base64");
  const response = await fetchImpl(`${wikiBase(config)}${pathAndQuery}`, { headers: { Authorization: `Basic ${auth}`, Accept: "application/json" } });
  if (!response.ok) throw new ConfluenceError(response.status, `Confluence ${response.status}: ${pathAndQuery.split("?")[0]}`);
  return (await response.json()) as T;
}

type SearchResponse = { results: { content?: { id: string; title: string; type: string } }[]; _links?: { next?: string } };

/** 정책 스페이스에서 제목에 `titleQuery`가 든 페이지. 다음 링크는 사이트 기준 경로라 게이트웨이 주소에 다시 붙인다. */
export async function searchPolicyPages(config: ConfluenceConfig, fetchImpl: FetchLike): Promise<{ id: string; title: string }[]> {
  const cql = `space=${config.spaceKey} AND type=page AND title~"${config.titleQuery}"`;
  let next: string | undefined = `/rest/api/search?cql=${encodeURIComponent(cql)}&limit=${searchPageSize}`;
  const pages: { id: string; title: string }[] = [];
  while (next) {
    const response: SearchResponse = await getJson<SearchResponse>(config, next, fetchImpl);
    for (const item of response.results) if (item.content?.type === "page") pages.push({ id: item.content.id, title: item.content.title });
    next = response._links?.next;
  }
  return pages;
}

type PageResponse = { id: string; title: string; version: { number: number; createdAt: string }; body?: { storage?: { value?: string } }; _links?: { webui?: string } };

export function hashBody(body: string): string {
  return createHash("sha256").update(body, "utf8").digest("hex");
}

/** 페이지와 본문(storage XHTML). 규칙 뽑기가 본문을 쓴다 */
export async function readPolicyPageWithBody(config: ConfluenceConfig, id: string, fetchImpl: FetchLike): Promise<{ page: PolicyPage; storage: string }> {
  const page = await getJson<PageResponse>(config, `/api/v2/pages/${encodeURIComponent(id)}?body-format=storage`, fetchImpl);
  const storage = page.body?.storage?.value ?? "";
  return {
    page: {
      id: page.id,
      title: page.title,
      version: page.version.number,
      modifiedAt: page.version.createdAt,
      hash: hashBody(storage),
      webUrl: `${config.siteUrl || wikiBase(config)}${page._links?.webui ?? `/pages/${page.id}`}`,
    },
    storage,
  };
}

export async function readPolicyPage(config: ConfluenceConfig, id: string, fetchImpl: FetchLike): Promise<PolicyPage> {
  return (await readPolicyPageWithBody(config, id, fetchImpl)).page;
}

/** 검색한 정책 + 등록 목록의 페이지를 읽어 스냅샷을 만든다. 한 페이지가 실패해도 나머지는 남긴다(실패 목록으로 돌려준다). */
export async function fetchPolicySnapshot(
  config: ConfluenceConfig,
  registeredIds: readonly string[],
  fetchImpl: FetchLike,
  now: () => Date = () => new Date(),
): Promise<{ snapshot: PolicySnapshot; failed: { id: string; message: string }[] }> {
  const found = await searchPolicyPages(config, fetchImpl);
  const ids = [...new Set([...found.map((page) => page.id), ...registeredIds])];
  const pages: Record<string, PolicyPage> = {};
  const failed: { id: string; message: string }[] = [];
  for (let start = 0; start < ids.length; start += pageConcurrency) {
    await Promise.all(
      ids.slice(start, start + pageConcurrency).map(async (id) => {
        try {
          pages[id] = await readPolicyPage(config, id, fetchImpl);
        } catch (error) {
          failed.push({ id, message: error instanceof Error ? error.message : String(error) });
        }
      }),
    );
  }
  return { snapshot: { checkedAt: now().toISOString(), pages }, failed };
}

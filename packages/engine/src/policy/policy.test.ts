import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { ConfluenceError, fetchPolicySnapshot, hashBody, type ConfluenceConfig, type FetchLike } from "./confluence";
import { readSnapshot, recordSnapshot } from "./store";

const config: ConfluenceConfig = { email: "a@b", token: "t", cloudId: "cloud", spaceKey: "SHOP", titleQuery: "통합 정책", siteUrl: "https://example.atlassian.net/wiki" };

// 가짜 Confluence: 검색 2쪽(다음 링크는 사이트 기준 경로) + 페이지 본문
function fakeConfluence(bodies: Record<string, string>, failing: string[] = []) {
  const urls: string[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    urls.push(url);
    assert.equal(init.headers.Authorization, `Basic ${Buffer.from("a@b:t").toString("base64")}`);
    const json = (value: unknown, status = 200) => ({ ok: status < 400, status, json: async () => value });
    if (url.includes("/rest/api/search") && !url.includes("cursor=2")) {
      return json({ results: [{ content: { id: "1", title: "출금 통합 정책", type: "page" } }], _links: { next: "/rest/api/search?cursor=2" } });
    }
    if (url.includes("cursor=2")) return json({ results: [{ content: { id: "2", title: "레벨 통합 정책", type: "page" } }] });
    const id = /pages\/(\w+)/.exec(url)?.[1] ?? "";
    if (failing.includes(id)) return json({}, 404);
    return json({ id, title: `정책 ${id}`, version: { number: 3, createdAt: "2026-11-01T00:00:00.000Z" }, body: { storage: { value: bodies[id] ?? "" } }, _links: { webui: `/spaces/SHOP/pages/${id}` } });
  };
  return { fetchImpl, urls };
}

// 검색 다음 쪽까지 따라가고, 등록 목록 페이지(9)도 읽는다. 모두 게이트웨이 주소로 부른다
{
  const { fetchImpl, urls } = fakeConfluence({ "1": "<p>a</p>", "2": "<p>b</p>", "9": "<p>c</p>" });
  const { snapshot, failed } = await fetchPolicySnapshot(config, ["9", "1"], fetchImpl, () => new Date("2026-11-11T00:00:00.000Z"));
  assert.deepEqual(Object.keys(snapshot.pages).sort(), ["1", "2", "9"]);
  assert.equal(snapshot.pages["1"].hash, hashBody("<p>a</p>"));
  assert.equal(snapshot.pages["1"].webUrl, "https://example.atlassian.net/wiki/spaces/SHOP/pages/1");
  assert.deepEqual(failed, []);
  assert.ok(urls.every((url) => url.startsWith("https://api.atlassian.com/ex/confluence/cloud/wiki/")), urls.join("\n"));
}

// 한 페이지가 실패해도 나머지는 남는다
{
  const { fetchImpl } = fakeConfluence({ "1": "a", "2": "b" }, ["2"]);
  const { snapshot, failed } = await fetchPolicySnapshot(config, [], fetchImpl);
  assert.deepEqual(Object.keys(snapshot.pages), ["1"]);
  assert.match(failed[0].message, /Confluence 404/);
}
assert.equal(new ConfluenceError(403, "x").status, 403);

// 저장: 처음엔 전부 추가, 본문이 바뀐 것만 다음에 변경으로 기록
{
  const root = mkdtempSync(path.join(tmpdir(), "policy-"));
  try {
    const first = await fetchPolicySnapshot(config, [], fakeConfluence({ "1": "a", "2": "b" }).fetchImpl);
    assert.deepEqual(recordSnapshot(first.snapshot, root).map((change) => change.kind), ["added", "added"]);
    const second = await fetchPolicySnapshot(config, [], fakeConfluence({ "1": "a", "2": "b-수정" }).fetchImpl);
    const changes = recordSnapshot(second.snapshot, root);
    assert.deepEqual(changes.map((change) => `${change.kind}:${change.page.id}`), ["changed:2"]);
    assert.equal(readSnapshot(root).pages["2"].hash, hashBody("b-수정"));
    assert.equal(readFileSync(path.join(root, "changes.jsonl"), "utf8").trim().split("\n").length, 3);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

console.log("policy ok");

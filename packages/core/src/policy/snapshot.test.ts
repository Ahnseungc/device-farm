import assert from "node:assert/strict";

import { diffSnapshots, emptySnapshot, isRecentlyChanged, type PolicyPage, type PolicySnapshot } from "./snapshot";

const page = (id: string, title: string, hash: string, version = 1): PolicyPage => ({ id, title, hash, version, modifiedAt: "2026-11-01T00:00:00.000Z", webUrl: `https://x/${id}` });
const snapshot = (...pages: PolicyPage[]): PolicySnapshot => ({ checkedAt: "", pages: Object.fromEntries(pages.map((item) => [item.id, item])) });

// 처음엔 전부 추가
assert.deepEqual(diffSnapshots(emptySnapshot, snapshot(page("1", "출금", "a"))).map((change) => change.kind), ["added"]);

// 본문 해시가 바뀌면 변경(이전 값 포함), 사라지면 삭제, 같으면 없음
{
  const before = snapshot(page("1", "출금", "a"), page("2", "레벨", "b"), page("3", "출석", "c"));
  const after = snapshot(page("1", "출금", "a2", 2), page("2", "레벨", "b"), page("4", "쿠폰", "d"));
  const changes = diffSnapshots(before, after);
  assert.deepEqual(changes.map((change) => `${change.kind}:${change.page.title}`), ["changed:출금", "removed:출석", "added:쿠폰"]);
  assert.equal(changes.find((change) => change.kind === "changed")?.before?.hash, "a");
}

// 제목만 바뀌고 본문이 같으면 바뀜이 아니다(버전은 올라도)
assert.deepEqual(diffSnapshots(snapshot(page("1", "출금 정책", "a")), snapshot(page("1", "출금 통합 정책", "a", 2))), []);

// 최근 14일 안 수정
{
  const now = Date.parse("2026-11-11T00:00:00.000Z");
  assert.equal(isRecentlyChanged({ modifiedAt: "2026-11-01T00:00:00.000Z" }, now), true);
  assert.equal(isRecentlyChanged({ modifiedAt: "2026-10-20T00:00:00.000Z" }, now), false);
  assert.equal(isRecentlyChanged({ modifiedAt: "" }, now), false);
}

console.log("policy snapshot ok");

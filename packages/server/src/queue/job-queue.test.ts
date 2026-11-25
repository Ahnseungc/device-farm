import assert from "node:assert/strict";

import { busyMessages, createJobQueue, maxQueuedJobs, queueFullMessage } from "./job-queue";

/** 손으로 끝내는 작업 */
function gated() {
  let finish: (error?: Error) => void = () => {};
  const promise = new Promise<void>((resolve, reject) => {
    finish = (error) => (error ? reject(error) : resolve());
  });
  return { work: () => promise, finish };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

// 바쁘면 막지 않고 쌓았다가, 앞의 것이 끝나면 들어온 순서대로 하나씩 돈다
{
  const order: string[] = [];
  let ends = 0;
  const logs: string[] = [];
  const queue = createJobQueue({ onJobEnd: () => void ends++, log: (message) => logs.push(message) });
  const a = gated();
  const b = gated();
  const first = queue.enqueue({ kind: "run", label: "A", source: "manual", work: () => (order.push("A"), a.work()) });
  assert.ok(first.ok);
  assert.equal(first.position, 0);
  assert.deepEqual(order, ["A"], "비어 있으면 바로 (동기로) 시작");
  assert.equal(queue.isBusy(), true);
  assert.equal(queue.busyMessage(), busyMessages.run);

  const second = queue.enqueue({ kind: "bot", label: "B", source: "nightly", ref: "시드 1", work: () => (order.push("B"), b.work()) });
  const third = queue.enqueue({ kind: "explore", label: "C", source: "auto", work: async () => void order.push("C") });
  assert.ok(second.ok && third.ok);
  assert.equal(second.position, 1);
  assert.equal(third.position, 2);
  const state = queue.state();
  assert.equal(state.running?.label, "A");
  assert.deepEqual(state.pending.map((job) => [job.label, job.source, job.ref]), [["B", "nightly", "시드 1"], ["C", "auto", undefined]]);
  assert.ok(logs.includes("B 대기 1번째"));

  // 앞의 것이 실패해도 다음 것은 돈다. 실패는 로그로 남고 done은 reject하지 않는다
  a.finish(new Error("설치 실패"));
  assert.equal(await first.done, "failed");
  assert.deepEqual(order, ["A", "B"]);
  assert.equal(queue.state().running?.label, "B");
  assert.ok(logs.includes("A 실패: 설치 실패"));
  b.finish();
  assert.equal(await second.done, "finished");
  assert.equal(await third.done, "finished");
  assert.deepEqual(order, ["A", "B", "C"]);
  assert.equal(ends, 3);
  assert.equal(queue.isBusy(), false);
  assert.deepEqual(queue.state(), { running: null, pending: [] });
}

// 기다리는 작업은 뺄 수 있다. 도는 작업·모르는 id는 false
{
  const queue = createJobQueue({ onJobEnd: () => {}, log: () => {} });
  const a = gated();
  const ran: string[] = [];
  const first = queue.enqueue({ kind: "run", label: "A", source: "manual", work: a.work });
  const second = queue.enqueue({ kind: "run", label: "B", source: "manual", work: async () => void ran.push("B") });
  const third = queue.enqueue({ kind: "run", label: "C", source: "manual", work: async () => void ran.push("C") });
  assert.ok(first.ok && second.ok && third.ok);
  assert.equal(queue.cancel(first.id), false, "도는 작업은 대기열 취소가 아니라 「중지」");
  assert.equal(queue.cancel("q-none"), false);
  assert.equal(queue.cancel(second.id), true);
  assert.equal(await second.done, "canceled");
  assert.equal(queue.cancel(second.id), false, "두 번 빼지 않는다");
  assert.deepEqual(queue.state().pending.map((job) => job.label), ["C"]);
  a.finish();
  await third.done;
  assert.deepEqual(ran, ["C"]);
}

// 대기열이 꽉 차면 거절한다
{
  const queue = createJobQueue({ onJobEnd: () => {}, log: () => {} });
  const a = gated();
  queue.enqueue({ kind: "run", label: "A", source: "manual", work: a.work });
  for (let index = 0; index < maxQueuedJobs; index += 1) assert.ok(queue.enqueue({ kind: "run", label: `${index}`, source: "manual", work: async () => {} }).ok);
  assert.deepEqual(queue.enqueue({ kind: "run", label: "넘침", source: "manual", work: async () => {} }), { ok: false, error: queueFullMessage });
  a.finish();
}

// 다시 돌리기는 비어 있을 때만 바로 돈다(대기열을 건너뛰지 않는다). 그동안 들어온 것은 끝난 뒤 돈다. 실패는 그대로 던진다
{
  const queue = createJobQueue({ onJobEnd: () => {}, log: () => {} });
  const a = gated();
  queue.enqueue({ kind: "run", label: "A", source: "manual", work: a.work });
  assert.equal(queue.startNow(async () => {}), null, "도는 중");
  a.finish();
  await tick();
  const r = gated();
  const replay = queue.startNow(r.work);
  assert.ok(replay);
  assert.equal(queue.busyMessage(), busyMessages.replay);
  assert.equal(queue.state().running, null, "다시 돌리기는 목록에 안 보인다");
  const ran: string[] = [];
  const queued = queue.enqueue({ kind: "bot", label: "B", source: "manual", work: async () => void ran.push("B") });
  assert.ok(queued.ok);
  assert.equal(queued.position, 1);
  r.finish(new Error("경로 없음"));
  await assert.rejects(replay, /경로 없음/);
  await queued.done;
  assert.deepEqual(ran, ["B"]);
}

// 급한 작업(QA 제보): 기다리는 것보다 앞에 서고, 도는 작업은 멈춰 이어 갈 칸을 급한 것 바로 뒤에 세운다.
// 멈춘 작업을 기다리던 쪽은 이어 간 칸이 끝날 때 끝난다
{
  const queue = createJobQueue({ onJobEnd: () => {}, log: () => {} });
  const order: string[] = [];
  const a = gated();
  const b = gated();
  let interrupted = 0;
  const first = queue.enqueue({
    kind: "run",
    label: "전체 점검",
    source: "manual",
    work: () => (order.push("전체"), a.work()),
    interrupt: () => {
      interrupted += 1;
      a.finish(); // 멈추기를 걸면 지금 항목까지 하고 끝난다
      return { kind: "run", label: "전체 점검 (이어서)", source: "manual", work: () => (order.push("이어서"), b.work()) };
    },
  });
  assert.ok(first.ok);
  queue.enqueue({ kind: "bot", label: "봇", source: "nightly", work: async () => void order.push("봇") });
  const qa = queue.enqueue({ kind: "run", label: "QA 제보 점검", source: "manual", urgent: true, work: async () => void order.push("QA") });
  assert.ok(qa.ok);
  assert.equal(qa.position, 1);
  assert.equal(interrupted, 1);
  assert.deepEqual(queue.state().pending.map((job) => job.label), ["QA 제보 점검", "전체 점검 (이어서)", "봇"]);
  // 급한 것이 하나 더 오면 앞의 급한 것 뒤, 이어서 칸 앞. 이미 멈추는 중이라 또 멈추지 않는다
  const qa2 = queue.enqueue({ kind: "run", label: "QA 2", source: "manual", urgent: true, work: async () => void order.push("QA2") });
  assert.ok(qa2.ok);
  assert.equal(interrupted, 1);
  assert.deepEqual(queue.state().pending.map((job) => job.label), ["QA 제보 점검", "QA 2", "전체 점검 (이어서)", "봇"]);
  let firstDone = false;
  void first.done.then(() => (firstDone = true));
  await qa.done;
  await tick();
  assert.equal(queue.state().running?.label, "전체 점검 (이어서)");
  assert.equal(firstDone, false, "이어서 칸이 끝나기 전에는 기다린다");
  b.finish();
  await first.done;
  await tick();
  assert.deepEqual(order, ["전체", "QA", "QA2", "이어서", "봇"]);
}

// 급한 작업이 돌 때 또 급한 것이 와도 멈추지 않는다. 멈출 수 없는 작업(interrupt 없음)은 끝날 때까지 기다린다. 꽉 차도 급한 것은 받는다
{
  const queue = createJobQueue({ onJobEnd: () => {}, log: () => {} });
  const a = gated();
  queue.enqueue({ kind: "explore", label: "탐색", source: "manual", work: a.work });
  for (let index = 0; index < maxQueuedJobs; index += 1) queue.enqueue({ kind: "run", label: `${index}`, source: "manual", work: async () => {} });
  const qa = queue.enqueue({ kind: "run", label: "QA", source: "manual", urgent: true, work: async () => {} });
  assert.ok(qa.ok);
  assert.equal(qa.position, 1);
  assert.equal(queue.state().running?.label, "탐색");
  a.finish();
}

console.log("job-queue ok");

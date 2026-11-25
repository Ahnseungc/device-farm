import assert from "node:assert/strict";

import { createContextHooks } from "./context-hooks";

// 다시 붙으면 새 연결에도 걸고, 풀 때는 지금 연결에서 푼다
{
  const log: string[] = [];
  let current = "A";
  const hooks = createContextHooks(() => current);
  const detach = await hooks.attach(async (context) => (log.push(`on ${context}`), async () => void log.push(`off ${context}`)));
  await hooks.reattach("B");
  current = "B";
  await detach();
  await detach();
  await hooks.reattach("C");
  assert.deepEqual(log, ["on A", "on B", "off B"]);
}

// 하나라도 못 걸면 throw한다. 새 연결은 쓰이지 않으므로 옛 연결에서 푼다
{
  const log: string[] = [];
  const hooks = createContextHooks(() => "A");
  const detach = await hooks.attach(async (context) => {
    if (context === "B") throw new Error("가드를 못 걸었습니다.");
    return async () => void log.push(`off ${context}`);
  });
  await assert.rejects(hooks.reattach("B"), /가드를 못 걸었습니다/);
  await detach();
  assert.deepEqual(log, ["off A"]);
}

console.log("context-hooks ok");

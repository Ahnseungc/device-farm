import assert from "node:assert/strict";

import { gatewayErrorOf, gatewayFailureMessage, gatewayGiveUpMs, gatewayRelaunchAfterMs, gatewayReloadWaitMs, waitOutGateway } from "./driver";

// nginx 게이트웨이 오류 화면은 상태 줄을 알아본다. 화면 안 문장에 섞인 숫자는 아니다
assert.equal(gatewayErrorOf("502 Bad Gateway\nnginx/1.24.0 (Ubuntu)"), "502 Bad Gateway");
assert.equal(gatewayErrorOf("504 Gateway Time-out\nnginx"), "504 Gateway Time-out");
assert.equal(gatewayErrorOf("503 Service Temporarily Unavailable"), "503 Service Temporarily Unavailable");
assert.equal(gatewayErrorOf("실물 금 구매 금 구매 후 리뷰만 남겨도 502 Bad Gateway"), null);

/** 배포가 `fixAfter`번 다시 불러온 뒤 끝나는 화면. 시계는 sleep만큼 간다 */
function deploy(fixAfter: number) {
  let clock = 0;
  const state = { reloads: 0, logs: [] as string[] };
  const deps = {
    bodyText: async () => (state.reloads >= fixAfter ? "홈" : "502 Bad Gateway\nnginx"),
    reload: async () => void (state.reloads += 1),
    sleep: async (ms: number) => void (clock += ms),
    log: (message: string) => void state.logs.push(message),
    now: () => clock,
  };
  return { deps, state };
}

// 오류 화면이 아니면 다시 불러오지 않는다
{
  const { deps, state } = deploy(0);
  assert.equal(await waitOutGateway(deps), null);
  assert.equal(state.reloads, 0);
  assert.equal(state.logs.length, 0);
}
// 배포가 끝나면 이어 간다. 로그는 한 번만
{
  const { deps, state } = deploy(3);
  assert.equal(await waitOutGateway(deps), null);
  assert.equal(state.reloads, 3);
  assert.equal(state.logs.length, 1);
}
// 끝내 안 풀리면 상태 줄. 포기 시간 안에서만 다시 불러온다
{
  const { deps, state } = deploy(Number.POSITIVE_INFINITY);
  assert.equal(await waitOutGateway(deps), "502 Bad Gateway");
  assert.equal(state.reloads, gatewayGiveUpMs / gatewayReloadWaitMs);
}
// 다시 불러와도 안 풀리면 앱을 한 번만 다시 켠다. 다시 켜서 풀리면 거기서 끝
{
  const { deps, state } = deploy(Number.POSITIVE_INFINITY);
  let relaunches = 0;
  let fixed = false;
  const result = await waitOutGateway({
    ...deps,
    bodyText: async () => (fixed ? "홈" : "502 Bad Gateway\nnginx"),
    relaunch: async () => {
      relaunches += 1;
      fixed = true;
    },
  });
  assert.equal(result, null);
  assert.equal(relaunches, 1);
  assert.equal(state.reloads, gatewayRelaunchAfterMs / gatewayReloadWaitMs);
  assert.match(state.logs[1], /30초 동안 안 풀려 앱을 다시 켜고/);
}
// 다시 켜도 안 풀리면 포기 시간까지 다시 불러오고, 다시 켜기는 한 번뿐. 다시 켜기가 실패해도 기다림은 이어 간다
{
  const { deps, state } = deploy(Number.POSITIVE_INFINITY);
  let relaunches = 0;
  const result = await waitOutGateway({
    ...deps,
    relaunch: async () => {
      relaunches += 1;
      throw new Error("adb 끊김");
    },
  });
  assert.equal(result, "502 Bad Gateway");
  assert.equal(relaunches, 1);
  assert.equal(state.reloads, gatewayGiveUpMs / gatewayReloadWaitMs);
  assert.ok(state.logs.some((line) => /앱 다시 켜기 실패: adb 끊김/.test(line)));
}
// 화면 글자를 못 읽으면(이동 중) 오류 화면이 아닌 것으로 본다
assert.equal(await waitOutGateway({ ...deploy(9).deps, bodyText: async () => Promise.reject(new Error("navigating")) }), null);
assert.match(gatewayFailureMessage('"출금하기" 버튼', "502 Bad Gateway"), /^"출금하기" 버튼 대신 웹 서버 오류 화면\(502 Bad Gateway\)이 보였습니다\. 300초/);

console.log("gateway ok");

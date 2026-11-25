import assert from "node:assert/strict";

import type { DeviceRun, DeviceScreen } from "../device/types";
import { failureAlertBlocks, failureAlertOf, failureTypeOf } from "./failure-alert";

const screen = (scenario: string, message: string, status: DeviceScreen["status"] = "failed"): DeviceScreen => ({ scenario, status, message });

// 플로우 실패는 동작 오류, 오류 화면·안 그려짐·데이터는 앱 오류
assert.equal(failureTypeOf(screen("플로우 점검 · 홈에서 알림 열기", "1단계 누르기 「알림」 실패")), "behavior");
assert.equal(failureTypeOf(screen("로그인 후 고객 문의 화면이 열린다", "/cs/inquiry 화면이 15초 안에 그려지지 않았습니다.")), "app-error");
// 점검 못 함(기기·연결)은 즉시 알림을 보내지 않는다
assert.equal(failureTypeOf({ ...screen("로그인 후 홈 화면이 열린다", "WebDriverError: A session is either terminated or not started"), status: "inconclusive" }), null);
assert.equal(failureTypeOf(screen("데이터 점검 · 마이 홈", "1개 실패 · 총자산 합계")), "app-error");
assert.equal(failureTypeOf(screen("화면 깨짐 점검 · /my", "[화면 깨짐] 글자 겹침 — 글자끼리 겹칩니다: 「a」↔「b」")), "design");
assert.equal(failureTypeOf(screen("배치 점검 · /my", "[배치] 글자 겹침 — 글자끼리 겹칩니다: 「a」↔「b」")), "design");
assert.equal(failureTypeOf(screen("로그인 후 리뷰 쓰기 화면이 열린다", "이동 실패: 앱이 …를 열지 않아 /benefit에 머물렀습니다.")), "behavior");
// 기준 화면 차이·정책 점검·통과·로그인 필요는 알리지 않는다
assert.equal(failureTypeOf(screen("로그인 후 홈 화면이 열린다", "기준 화면과 다릅니다.")), null);
assert.equal(failureTypeOf(screen("정책 점검 · /order", "어긋남 3개")), null);
assert.equal(failureTypeOf(screen("플로우 점검 · 홈", "", "passed")), null);
assert.equal(failureTypeOf(screen("로그인 후 홈", "", "login_required")), null);

const device = { id: "d1", platform: "android", model: "SM-A325N", osVersion: "13" } as DeviceRun["outcomes"][number]["device"];
const run = { runId: "r1", kind: "dev", version: "2.0.28+463", trigger: "auto", startedAt: "", finishedAt: null, outcomes: [] } as DeviceRun;
const outcome = { device, status: "running", screens: [] } as DeviceRun["outcomes"][number];
const first = failureAlertOf(run, outcome, screen("플로우 점검 · 홈", "3단계 실패: 12:01:02에 응답 없음"));
const again = failureAlertOf({ ...run, runId: "r2" }, outcome, screen("플로우 점검 · 홈", "3단계 실패: 12:05:40에 응답 없음"));
// 시각이 달라도 같은 실패면 같은 키(한 번만 보낸다)
assert.equal(first?.key, again?.key);

const blocks = JSON.stringify(failureAlertBlocks(first!));
assert.ok(blocks.includes("동작 오류") && blocks.includes("처리 완료"));
assert.ok(!JSON.stringify(failureAlertBlocks(first!, { status: "done", by: "U1" })).includes('"type":"actions"'));

console.log("failure alert ok");

// 「문제 아님」을 누른 실패는 다음 점검부터 통과로 넘긴다(숫자가 달라도 같은 실패)
{
  const { skipIgnoredFailures, failureIgnoreKey, failureIgnoreHash } = await import("./failure-alert");
  const screens: import("../device/types").DeviceScreen[] = [
    { scenario: "플로우 점검 · a", status: "failed", message: '"x" 문구가 10000ms 안에 나오지 않았습니다.' },
    { scenario: "플로우 점검 · b", status: "failed", message: "다른 실패" },
  ];
  const ignores = [{ key: failureIgnoreKey("플로우 점검 · a", '"x" 문구가 5000ms 안에 나오지 않았습니다.'), hash: failureIgnoreHash, reason: "문제 아님 (U1)" }];
  assert.equal(skipIgnoredFailures(screens, ignores), 1);
  assert.equal(screens[0].status, "passed");
  assert.match(screens[0].message ?? "", /^문제 아님으로 넘김\(문제 아님 \(U1\)\): /);
  assert.equal(screens[1].status, "failed");
}

// 버튼 에러는 원인만 보고, 기준 학습 앞머리는 키에서 뺀다 — 알림 본문(버튼 이름)이 바뀌거나 학습이 끝나도 같은 실패
{
  const { failureIgnoreKey } = await import("./failure-alert");
  const scenario = "로그인 후 알림 화면이 열린다";
  const yesterday = "기준 학습 중(3/4): 바뀌는 곳을 비교에서 뺐습니다. · 버튼 12개 · 에러 1(추첨 17시간 전) · 건너뜀 1 · 에러 원인: GET 404 https://a.shop.example.com/v1/lottery/7";
  const today = "버튼 11개 · 에러 1(퀴즈 2시간 전) · 에러 원인: GET 404 https://a.shop.example.com/v1/lottery/9";
  assert.equal(failureIgnoreKey(scenario, yesterday), failureIgnoreKey(scenario, today));
  assert.notEqual(failureIgnoreKey(scenario, today), failureIgnoreKey(scenario, "버튼 11개 · 에러 1(퀴즈) · 에러 원인: GET 500 https://a.shop.example.com/v1/lottery/9"));
  assert.equal(failureIgnoreKey(scenario, "기준 학습 중(3/4): 바뀌는 곳을 비교에서 뺐습니다. · 앱 오류"), failureIgnoreKey(scenario, "앱 오류"));
}

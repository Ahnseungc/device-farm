import assert from "node:assert/strict";

import { sampleApp } from "../config/sample-app";
import { actionKey, chaosCandidates, isAvoidedName, pickWeighted, scoreAction, scoreAll, seededRandom } from "./policy";

const nav = { ...sampleApp, noPressPathPattern: sampleApp.guard.noPressPathPattern };

// 후보: 누르기는 요소마다, 탭·카오스는 종류마다 하나. 연타는 직전 버튼이 보일 때만. 탭 루트(/benefit)라 뒤로는 없다
{
  const targets = [
    { role: "button" as const, name: "OX퀴즈" },
    { role: "button" as const, name: "출석체크" },
    { role: "link" as const, name: "혜택" },
    { role: "link" as const, name: "홈" },
  ];
  const kinds = chaosCandidates({ nav, path: "/benefit", targets, lastPressed: { role: "button", name: "OX퀴즈" } }).map(actionKey);
  assert.deepEqual(kinds, [
    "press:button:OX퀴즈",
    "press:button:출석체크",
    "tab::",
    "doubleTap:button:OX퀴즈",
    "backDuringLoad::",
    "background::",
    "restart::",
    "homeReset::",
  ]);
  assert.equal(chaosCandidates({ nav, path: "/a", targets, lastPressed: { role: "button", name: "없는 버튼" } }).some((a) => a.kind === "doubleTap"), false);
}

// 점수: 안 해 본 것 우선, 새 화면 ×2, 오류 근처 ×3, 반응 없음 2번 이상 ×0.2
{
  const press = { kind: "press" as const, role: "button" as const, name: "a" };
  assert.equal(scoreAction(press, undefined), 1);
  assert.equal(scoreAction(press, { tries: 3, openedNew: false, errors: 0, dead: 0 }), 0.25);
  assert.equal(scoreAction(press, { tries: 1, openedNew: true, errors: 1, dead: 0 }), 3);
  assert.equal(scoreAction(press, { tries: 1, openedNew: false, errors: 0, dead: 2 }), 0.1);
  const scored = scoreAll([press, { kind: "back" }], () => undefined, "/a");
  assert.deepEqual(scored.map((item) => Number(item.probability.toFixed(3))), [0.769, 0.231]);
}

// 시드가 같으면 같은 순서로 뽑는다
{
  const items = [{ score: 1 }, { score: 0.3 }, { score: 0.15 }];
  const draw = (seed: number) => {
    const random = seededRandom(seed);
    return Array.from({ length: 20 }, () => items.indexOf(pickWeighted(items, random)));
  };
  assert.deepEqual(draw(42), draw(42));
  assert.notDeepEqual(draw(42), draw(7));
  // 점수 비례: 1등이 대부분이지만 다른 것도 나온다
  const counts = [0, 0, 0];
  const random = seededRandom(1);
  for (let i = 0; i < 2000; i += 1) counts[items.indexOf(pickWeighted(items, random))] += 1;
  assert.ok(counts[0] > 1200 && counts[1] > 250 && counts[2] > 120, JSON.stringify(counts));
}

// 광고·디버그 칩·스토어 설치 버튼은 누르지 않는다
for (const name of ["테스트 광고 : Google Ads", "Dismiss", "설치", "Install"]) assert.equal(isAvoidedName(name, sampleApp.guard.avoidedNamePattern), true, name);
assert.equal(isAvoidedName("출석체크", sampleApp.guard.avoidedNamePattern), false);

// 누르기 상한: 버튼이 많아도 누르기 전체 비중은 상한(3)까지. 같은 화면에 오래 머물면 나가는 행동이 커진다
{
  const many = Array.from({ length: 30 }, (_, index) => ({ role: "button" as const, name: `${index}` }));
  const scored = scoreAll(chaosCandidates({ nav, path: "/news", targets: many }), () => undefined, "/news");
  const pressMass = scored.filter((item) => item.action.kind === "press").reduce((sum, item) => sum + item.score, 0);
  assert.equal(Number(pressMass.toFixed(6)), 3);
  const back = (stay: number) => scoreAll(chaosCandidates({ nav, path: "/news", targets: many }), () => undefined, "/news", stay).find((item) => item.action.kind === "back");
  assert.equal(back(0)?.score, 0.3);
  assert.equal(Number(back(6)?.score.toFixed(6)), 1.2);
  // 머물수록 누르기는 줄어든다
  const pressAt = (stay: number) => scoreAll(chaosCandidates({ nav, path: "/news", targets: many }), () => undefined, "/news", stay).find((item) => item.action.kind === "press")?.score ?? 0;
  assert.equal(Number((pressAt(0) / pressAt(6)).toFixed(6)), 4);
  assert.ok((back(6)?.probability ?? 0) > (back(0)?.probability ?? 0));
}

// 비밀번호·PIN 화면은 누르기·연타·로딩 중 뒤로 없이 나가기만
{
  const keypad = ["1", "2", "3"].map((name) => ({ role: "button" as const, name }));
  const kinds = chaosCandidates({ nav, path: "/my/simple-password/change", targets: keypad, lastPressed: keypad[0] }).map((action) => action.kind);
  assert.deepEqual(kinds, ["back", "background", "restart", "homeReset"]);
}

// 링크 우선, 기록은 화면마다 따로
{
  const scored = scoreAll(chaosCandidates({ nav, path: "/a", targets: [{ role: "button", name: "b" }, { role: "link", name: "l" }] }), () => undefined, "/a");
  const of = (name: string) => scored.find((item) => item.action.name === name)?.score;
  assert.equal(of("l"), 1.5);
  assert.equal(of("b"), 1);
  const tried = { tries: 3, openedNew: false, errors: 0, dead: 0 };
  const close = [{ kind: "press" as const, role: "button" as const, name: "닫기" }];
  assert.equal(scoreAll(close, (key) => (key === "/a|press:button:닫기" ? tried : undefined), "/a")[0].score, 0.25);
  assert.equal(scoreAll(close, (key) => (key === "/a|press:button:닫기" ? tried : undefined), "/b")[0].score, 1);
}

// 탭 루트에서는 화면 안 뒤로 버튼이 있을 때만 뒤로
assert.equal(chaosCandidates({ nav, path: "/home", targets: [{ role: "button", name: "알림" }] }).some((action) => action.kind === "back"), false);
assert.equal(chaosCandidates({ nav, path: "/my/report", targets: [{ role: "button", name: "알림" }] }).some((action) => action.kind === "back"), true);

// 안 가 본 경로로 가는 링크는 3배
{
  const targets = [{ role: "link" as const, name: "새 화면", to: "/new" }, { role: "link" as const, name: "본 화면", to: "/seen" }];
  const scored = scoreAll(chaosCandidates({ nav, path: "/a", targets }), () => undefined, "/a", 0, (path) => path === "/seen");
  assert.equal(scored.find((item) => item.action.name === "새 화면")?.score, 4.5);
  assert.equal(scored.find((item) => item.action.name === "본 화면")?.score, 1.5);
}

// 지금보다 깊은 경로로 가는 링크는 1.5배 더(안 가 본 경로 3배와 같이 곱한다)
{
  const targets = [{ role: "link" as const, name: "깊은", to: "/a/b/c" }, { role: "link" as const, name: "얕은", to: "/z" }];
  const scored = scoreAll(chaosCandidates({ nav, path: "/a", targets }), () => undefined, "/a", 0, () => true);
  assert.equal(scored.find((item) => item.action.name === "깊은")?.score, 2.25);
  assert.equal(scored.find((item) => item.action.name === "얕은")?.score, 1.5);
}

console.log("chaos policy ok");

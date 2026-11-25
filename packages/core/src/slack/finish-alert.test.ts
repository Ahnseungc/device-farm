import assert from "node:assert/strict";

import type { ChaosRun } from "../chaos/types";
import type { DeviceRun } from "../device/types";

import {
  botFinishAlert,
  deviceFinishAlert,
  devicePausedAlert,
  deviceStartAlert,
  durationLabel,
  stoppedText,
  exploreFinishAlert,
  finishEmoji,
} from "./finish-alert";

const blockText = (alert: { blocks: unknown[] }) =>
  (alert.blocks[0] as { text: { text: string } }).text.text;

assert.equal(
  durationLabel("2026-11-16T03:00:00Z", "2026-11-16T03:00:30Z"),
  "1분 미만",
);
assert.equal(
  durationLabel("2026-11-16T03:00:00Z", "2026-11-16T03:12:00Z"),
  "12분",
);
assert.equal(
  durationLabel("2026-11-16T03:00:00Z", "2026-11-16T04:05:00Z"),
  "1시간 5분",
);
assert.equal(
  durationLabel("2026-11-16T03:00:00Z", "2026-11-16T05:00:00Z"),
  "2시간",
);

// 기기 점검: 실패가 있으면 ❌, 화면 상태별 수와 기기별 결과
{
  const screen = (status: "passed" | "failed") =>
    ({
      scenario: "s",
      status,
    }) as DeviceRun["outcomes"][number]["screens"][number];
  const run = {
    runId: "r",
    kind: "dev",
    version: "2.0.29+464",
    trigger: "auto",
    label: "야간 플로우 점검",
    startedAt: "2026-11-16T03:00:00Z",
    finishedAt: "2026-11-16T03:20:00Z",
    outcomes: [
      {
        device: { id: "x", model: "SM-A325N" },
        status: "failed",
        message: "실패 1",
        screens: [screen("passed"), screen("failed")],
      },
    ],
  } as unknown as DeviceRun;
  const alert = deviceFinishAlert(run);
  assert.equal(alert.text, ":x: 야간 플로우 점검 끝 · 20분");
  assert.match(blockText(alert), /자동 · 화면 2개 \(통과 1 · 실패 1\)/);
  assert.match(blockText(alert), /• SM-A325N 실패 1/);
  // 실패한 것 이름(전에 알린 실패도 끝 알림에는 나온다)
  assert.match(blockText(alert), /실패한 것:\n  – s/);
}

// 기기 결과의 영어·기술 오류는 풀어 쓴 한국어로, 메시지가 없으면 상태 이름
{
  const run = {
    runId: "r",
    kind: "dev",
    version: "1",
    trigger: "manual",
    startedAt: "2026-11-16T03:00:00Z",
    finishedAt: "2026-11-16T03:01:00Z",
    outcomes: [
      { device: { id: "a", model: "SM-A325N" }, status: "failed", message: 'Unable to connect to "http://127.0.0.1:4723/", make sure browser driver is running on that address.', screens: [] },
      { device: { id: "b", model: "iPhone 16" }, status: "offline", screens: [] },
    ],
  } as unknown as DeviceRun;
  const text = blockText(deviceFinishAlert(run));
  assert.match(text, /• SM-A325N 기기를 조종하는 프로그램\(Appium\)이 꺼져 있어/);
  assert.match(text, /• iPhone 16 기기가 연결되어 있지 않아요/);
}

// 봇 점검: 오류 스텝이 있으면 ⚠️, 요약 문장을 붙인다
{
  const step = (from: string, to: string, errors: number) => ({
    from,
    to,
    errors: Array.from({ length: errors }, () => ({
      kind: "layout",
      message: "m",
    })),
  });
  const run = {
    runId: "b",
    deviceId: "A32",
    seed: 1,
    startedAt: "2026-11-16T03:30:00Z",
    finishedAt: "2026-11-16T04:00:00Z",
    steps: [step("/a", "/b", 0), step("/b", "/c", 1)],
    states: 3,
    blocked: ["POST /x"],
  } as unknown as ChaosRun;
  const alert = botFinishAlert(run, "빈 화면 확인 필요");
  assert.equal(alert.text, ":warning: 봇 점검 끝 · A32 · 30분");
  assert.match(
    blockText(alert),
    /스텝 2 · 다닌 화면 3곳 · 오류 스텝 1 · 막은 쓰기 1\n빈 화면 확인 필요/,
  );
}

// 탐색: 기기·경로·문제 수
{
  const alert = exploreFinishAlert([
    {
      runId: "e",
      deviceId: "A32",
      startedAt: "2026-11-16T05:00:00Z",
      finishedAt: "2026-11-16T05:10:00Z",
      paths: [{}, {}],
      issues: [],
      blocked: [],
      cleanPathIds: [],
      replayFailures: [],
    },
  ] as never);
  assert.equal(alert.text, ":white_check_mark: 탐색 점검 끝 · 10분");
  assert.match(blockText(alert), /기기 1대 · 경로 2개 · 문제 0건/);
}

// 끝 알림 이모지·줄: 앱 실패만 ❌, 기준 화면 차이·점검 못 함은 ⚠️ 
{
  type Screen = DeviceRun["outcomes"][number]["screens"][number];
  const runOf = (screens: Partial<Screen>[], outcome: Record<string, unknown> = {}) =>
    ({
      runId: "r",
      kind: "dev",
      version: "1",
      trigger: "auto",
      startedAt: "2026-11-20T03:00:00Z",
      finishedAt: "2026-11-20T03:10:00Z",
      outcomes: [{ device: { id: "x", model: "SM-A325N" }, status: "passed", screens: screens.map((screen, index) => ({ scenario: `s${index}`, ...screen })), ...outcome }],
    }) as unknown as DeviceRun;

  const appFail = runOf([{ status: "failed", message: "/x 화면이 15초 안에 그려지지 않았습니다." }], { status: "failed" });
  assert.equal(finishEmoji(appFail), ":x:");
  assert.match(blockText(deviceFinishAlert(appFail)), /실패한 것:\n  – s0/);

  const changed = runOf([{ status: "failed", message: "기준 화면과 다릅니다." }, { status: "failed", message: "기준 화면과 크기가 다릅니다." }, { status: "passed" }], { status: "failed" });
  assert.equal(finishEmoji(changed), ":warning:");
  assert.equal(deviceFinishAlert(changed).text.startsWith(":warning:"), true);
  assert.doesNotMatch(blockText(deviceFinishAlert(changed)), /실패한 것/);
  assert.match(blockText(deviceFinishAlert(changed)), /화면 바뀜 2 \(기준 화면 탭에서 확인\)/);

  const lost = runOf([{ status: "inconclusive", message: "WebDriverError: A session is either terminated or not started" }]);
  assert.equal(finishEmoji(lost), ":warning:");
  assert.match(blockText(deviceFinishAlert(lost)), /점검 못 함 1 \(기기·연결\)/);

  const retried = runOf([{ status: "passed", message: "다시 돌려 통과 (첫 시도: 느림)" }]);
  assert.equal(finishEmoji(retried), ":white_check_mark:");
  assert.match(blockText(deviceFinishAlert(retried)), /다시 돌려 통과 1/);
  assert.doesNotMatch(blockText(deviceFinishAlert(runOf([{ status: "passed" }]))), /다시 돌려 통과|화면 바뀜|점검 못 함/);

  assert.equal(finishEmoji(runOf([], { status: "install_failed" })), ":x:");
  assert.equal(finishEmoji(runOf([], { status: "offline" })), ":warning:");
  assert.equal(finishEmoji(runOf([], { status: "login_required" })), ":warning:");
  assert.equal(finishEmoji(runOf([], { status: "skipped" })), ":white_check_mark:");
  assert.equal(finishEmoji(runOf([], { status: "failed" })), ":warning:");
}

// 기기가 중간에 실패로 끝났는데 앱 실패 화면이 없으면 ⚠️ (다시 열기 실패 등, 최종 리뷰)
{
  const run = {
    runId: "r", kind: "dev", version: "1", trigger: "auto", startedAt: "2026-11-20T03:00:00Z", finishedAt: "2026-11-20T03:10:00Z",
    outcomes: [{ device: { id: "x", model: "SM-A325N" }, status: "failed", message: "CDP 연결을 만들지 못했습니다", screens: [{ scenario: "s0", status: "passed" }] }],
  } as unknown as DeviceRun;
  assert.equal(finishEmoji(run), ":warning:");
}

// 시작 알림: 무엇이 몇 개, 어느 기기로. 멈춤 알림: 끝이 아니라 QA 제보 뒤 이어서 돈다
{
  const started = {
    runId: "r2",
    kind: "dev",
    version: "2.0.31+472",
    trigger: "manual",
    startedAt: "2026-11-24T00:00:00Z",
    scenarioCount: 126,
    outcomes: [{ device: { id: "x", model: "SM-A325N" }, status: "running", screens: [{ scenario: "a", status: "passed" }, { scenario: "b", status: "inconclusive", message: stoppedText }] }],
  } as unknown as DeviceRun;
  const start = deviceStartAlert(started);
  assert.equal(start.text, ":arrow_forward: dev 2.0.31+472 기기 점검 시작");
  assert.match(blockText(start), /수동 · 항목 126개 · SM-A325N/);
  const paused = devicePausedAlert({ ...started, label: "기기 점검 (이어서)" });
  assert.equal(paused.text, ":pause_button: 기기 점검 (이어서) 멈춤 · QA 제보 점검을 먼저 돌려요");
  assert.match(blockText(paused), /끝난 항목 1개/);
}

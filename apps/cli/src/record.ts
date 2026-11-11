// 조작 기록: npm run record -- --device <Android serial> [--seconds 300] [--name "플로우 이름"]
// 홈으로 간 뒤 기록을 시작한다. 그동안 사람(또는 에이전트)이 기기를 움직이고, Ctrl+C나 시간이 다 되면 끝낸다.
// 끝나면 화면 지도에 간선을 합치고, 홈부터 다시 돌 수 있는 스텝이면 플로우 후보로 올린다.
import { createHash } from "node:crypto";

import { stepsOf, type FlowDocument } from "@device-farm/core/flows/schema";
import { mapRulesOf } from "@device-farm/core/flows/map-flow";
import { buildRecording } from "@device-farm/core/record/recording";
import { openAndroidDriver } from "@device-farm/devices/android-driver";
import { startRecorder } from "@device-farm/devices/recorder";
import { addCandidate, readReady } from "@device-farm/engine/flows/store";
import { recordScreenMap } from "@device-farm/engine/screen-map-store";
import { webOrigin } from "@device-farm/server/env";

import { cliApp } from "./app";

/** 기본 기록 시간 (작성자 판단) */
const defaultSeconds = 300;
const recordIdHashLength = 8;

function option(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const app = await cliApp();
  const serial = option("device");
  if (!serial) throw new Error("--device <Android serial>가 필요합니다.");
  const seconds = Number(option("seconds") ?? defaultSeconds);
  const origin = webOrigin(app, "dev");
  const driver = await openAndroidDriver(serial, app.appIds.dev, origin, app);
  try {
    if (!driver.goHome) throw new Error("홈으로 갈 수 없는 드라이버입니다.");
    await driver.goHome();
    const recorder = await startRecorder(driver, origin);
    console.log(`기록 시작 (${recorder.startPath}). ${seconds}초 뒤 또는 Ctrl+C로 끝냅니다.`);
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, seconds * 1000);
      process.once("SIGINT", () => (clearTimeout(timer), resolve()));
    });
    const events = await recorder.stop();
    const result = buildRecording(events, recorder.startPath, mapRulesOf(app));
    for (const screen of result.screens) recordScreenMap(screen.from, screen.buttons);
    console.log(`\n이벤트 ${events.length}개 · 지도 화면 ${result.screens.length}개에 합침`);
    for (const event of events) console.log(event.type === "click" ? `  누르기 ${event.from} 「${event.name}」 → ${event.to}${event.texts[0] ? ` (${event.texts[0]})` : ""}` : `  이동 ${event.from} → ${event.to}`);
    if (result.cut) console.log(`스텝을 여기서 끊음: ${result.cut}`);

    const steps = stepsOf(result.steps, app.guard.forbiddenClickNames);
    if (typeof steps === "string") return console.log(`플로우 후보로 올리지 않음: ${steps}`);
    const id = `rec-${createHash("sha256").update(JSON.stringify(steps)).digest("hex").slice(0, recordIdHashLength)}`;
    const name = option("name") ?? `기록 ${new Date().toLocaleString("ko-KR")}`;
    const proposal = readReady().some((flow) => flow.id === id) ? "update" : "create";
    const flow: FlowDocument = { id, name, source: "recorded", status: "generated", prd: "조작 기록", requirement: `기록한 스텝 ${steps.length}개`, proposal, steps };
    addCandidate(flow);
    console.log(`플로우 후보 「${name}」(${id})를 올렸습니다. 디바이스팜 플로우 탭에서 확정하세요.`);
  } finally {
    await driver.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

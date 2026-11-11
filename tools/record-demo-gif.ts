// README용 docs/assets/demo.gif를 데모 빌드에서 다시 만든다(기기·서버 없음).
//   npm run demo:build && npx tsx tools/record-demo-gif.ts
// 데모 미리 보기(127.0.0.1:5499)를 띄우고 Playwright로 기기 → 실패 상세 → 화면 지도 → 카오스 → 정책을 돌며 영상을 찍은 뒤
// ffmpeg(팔레트 2단계)로 GIF를 만든다. ffmpeg가 PATH에 있어야 한다.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, renameSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { chromium, type Page } from "playwright";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const output = path.join(root, "docs/assets/demo.gif");
const port = 5499;
const url = `http://127.0.0.1:${port}/`;
const viewport = { width: 1280, height: 800 };
const gifWidth = 800;
const gifFps = 10;
const serverWaitMs = 15_000;
const pollMs = 250;

const pause = (page: Page, ms: number) => page.waitForTimeout(ms);

async function waitForServer(): Promise<void> {
  const deadline = Date.now() + serverWaitMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // 아직 안 떴다
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  throw new Error(`데모 미리 보기가 ${url}에 뜨지 않았습니다. npm run demo:build를 먼저 돌렸나요?`);
}

async function openTab(page: Page, label: string): Promise<void> {
  await page.getByRole("navigation", { name: "화면" }).getByRole("button", { name: label, exact: true }).click();
  await pause(page, 900);
}

async function smoothScroll(page: Page, to: number): Promise<void> {
  await page.evaluate(async (target) => {
    const main = document.querySelector(".farm-main") ?? document.scrollingElement;
    if (!main) return;
    const start = main.scrollTop;
    const steps = 20;
    for (let index = 1; index <= steps; index += 1) {
      main.scrollTop = start + ((target - start) * index) / steps;
      window.scrollTo(0, start + ((target - start) * index) / steps);
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
  }, to);
}

async function walkthrough(page: Page): Promise<void> {
  await page.goto(url);
  await page.getByRole("article", { name: "Pixel 8" }).waitFor();
  await pause(page, 2_200);

  await openTab(page, "결과");
  await pause(page, 1_000);
  await page.getByRole("button", { name: /Pixel 8 실패 상세 보기/ }).first().click();
  await pause(page, 3_200);
  await page.keyboard.press("Escape");
  await pause(page, 600);

  await openTab(page, "플로우");
  const map = page.getByRole("region", { name: "화면 지도", exact: true });
  await map.scrollIntoViewIfNeeded();
  await pause(page, 1_200);
  await map.getByRole("button", { expanded: false }).first().click();
  await pause(page, 2_200);

  await openTab(page, "카오스");
  await smoothScroll(page, 0);
  await page.getByRole("button", { name: /로딩 중 뒤로/ }).first().click();
  await pause(page, 600);
  await page.getByRole("img", { name: /7스텝 화면/ }).scrollIntoViewIfNeeded();
  await pause(page, 2_600);

  await openTab(page, "정책");
  await smoothScroll(page, 0);
  await pause(page, 1_000);
  await page.getByRole("button", { name: /출석체크 정책/ }).click();
  await pause(page, 600);
  await page.getByRole("region", { name: "뽑은 규칙", exact: true }).scrollIntoViewIfNeeded();
  await pause(page, 2_400);
}

function toGif(video: string): void {
  const filters = `fps=${gifFps},scale=${gifWidth}:-1:flags=lanczos`;
  const palette = path.join(path.dirname(video), "palette.png");
  const run = (args: string[]) => {
    const result = spawnSync("ffmpeg", ["-y", "-loglevel", "error", ...args], { stdio: "inherit" });
    if (result.status !== 0) throw new Error(`ffmpeg 실패: ${args.join(" ")}`);
  };
  run(["-i", video, "-vf", `${filters},palettegen=max_colors=128:stats_mode=diff`, palette]);
  run(["-i", video, "-i", palette, "-lavfi", `${filters}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`, output]);
}

async function main(): Promise<void> {
  const server = spawn("npx", ["vite", "preview", "--config", "apps/web/demo/vite.config.ts", "--configLoader", "runner"], { cwd: root, stdio: "ignore" });
  const workDir = mkdtempSync(path.join(tmpdir(), "device-farm-demo-"));
  try {
    await waitForServer();
    const browser = await chromium.launch();
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1, locale: "ko-KR", recordVideo: { dir: workDir, size: viewport } });
    const page = await context.newPage();
    await walkthrough(page);
    const video = page.video();
    await context.close();
    await browser.close();
    if (!video) throw new Error("영상이 없습니다.");
    const raw = path.join(workDir, "demo.webm");
    renameSync(await video.path(), raw);
    toGif(raw);
    console.log(`${path.relative(root, output)} · ${(statSync(output).size / 1024 / 1024).toFixed(2)} MB`);
  } finally {
    server.kill();
    if (existsSync(workDir)) rmSync(workDir, { recursive: true, force: true });
  }
}

await main();

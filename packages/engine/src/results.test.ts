import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { Device, DeviceRun } from "@device-farm/core/device/types";
import type { Exec } from "@device-farm/devices/exec";

import {
  closeUnfinishedRun,
  ffmpegEncodeVideo,
  pruneRuns,
  readLatestRun,
  restartMessage,
  writeFailureBundle,
  writeRun,
  type BundleFrame,
} from "./results";

const dayMs = 24 * 60 * 60_000;
const now = Date.parse("2026-10-23T00:00:00.000Z");
const device: Device = { id: "R3CN", platform: "android", model: "SM-S918N", osVersion: "14", appVersion: "2.1.5" };

function run(runId: string, startedAt: number, overrides: Partial<DeviceRun> = {}): DeviceRun {
  return {
    runId,
    kind: "dev",
    version: "2.1.5",
    trigger: "manual",
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: new Date(startedAt + 1000).toISOString(),
    outcomes: [{ device, status: "passed", screens: [{ scenario: "홈", status: "passed" }] }],
    ...overrides,
  };
}

const root = mkdtempSync(path.join(tmpdir(), "results-test-"));
try {
  writeRun(run("old", now - 31 * dayMs), root);
  writeRun(run("recent", now - 29 * dayMs), root);
  writeRun(run("passed", now - dayMs), root);
  assert.deepEqual(readdirSync(path.join(root, "passed")), ["run.json"]);
  assert.equal(readLatestRun(root)?.runId, "passed");

  assert.equal(pruneRuns(root, now), 1);
  assert.equal(existsSync(path.join(root, "old")), false);
  assert.equal(existsSync(path.join(root, "recent")), true);

  assert.equal(closeUnfinishedRun(root, () => now), false);
  writeRun(
    run("crashed", now, {
      finishedAt: null,
      outcomes: [
        { device, status: "passed", screens: [] },
        { device: { ...device, id: "B" }, status: "running", screens: [] },
      ],
    }),
    root,
  );
  assert.equal(closeUnfinishedRun(root, () => now + 5000), true);
  const closed = readLatestRun(root);
  assert.equal(closed?.finishedAt, new Date(now + 5000).toISOString());
  assert.equal(closed?.outcomes[0].status, "passed");
  assert.deepEqual([closed?.outcomes[1].status, closed?.outcomes[1].message], ["skipped", restartMessage]);

  const bundleDir = path.join(root, "crashed", "R3CN", "home");
  const encoded: Array<{ count: number; outFile: string }> = [];
  await writeFailureBundle(
    bundleDir,
    {
      logs: [{ at: now, source: "console", text: "boom" }],
      frames: [{ at: now, frame: Buffer.from([1]) }],
      screenshot: Buffer.from("shot"),
      baseline: { baseline: Buffer.from("base"), diff: Buffer.from("diff") },
    },
    { encodeVideo: async (frames, outFile) => void encoded.push({ count: frames.length, outFile }) },
  );
  assert.deepEqual(readdirSync(bundleDir).sort(), ["baseline.png", "diff.png", "logs.jsonl", "screenshot.png"]);
  assert.deepEqual(JSON.parse(readFileSync(path.join(bundleDir, "logs.jsonl"), "utf8").trim()), { at: now, source: "console", text: "boom" });
  assert.deepEqual(encoded, [{ count: 1, outFile: path.join(bundleDir, "video.mp4") }]);

  const calls: string[][] = [];
  const fakeFfmpeg: Exec = async (command, args) => {
    calls.push([command, ...args]);
    return "";
  };
  const jpegFrames: BundleFrame[] = [0, 500, 1000].map((at) => ({ at, frame: Buffer.from([0xff, 0xd8, at % 7]) }));
  await ffmpegEncodeVideo(fakeFfmpeg)(jpegFrames, "/out/video.mp4");
  assert.equal(calls[0][0], "ffmpeg");
  assert.equal(calls[0][calls[0].indexOf("-f") + 1], "mjpeg");
  assert.equal(calls[0][calls[0].indexOf("-framerate") + 1], "3");
  assert.equal(calls[0].at(-1), "/out/video.mp4");
  assert.equal(existsSync(calls[0][calls[0].indexOf("-i") + 1]), false);
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log("results ok");

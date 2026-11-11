import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { PNG } from "pngjs";

import { buildMask, compareImages, diffMessage, failRatio, sizeMessage, type RgbaImage } from "@device-farm/core/baseline/diff";

import { archiveLimit, baselineState, clearPending, confirmPending, confirmScenario, readPending, saveCandidate } from "./store";

function solid(width: number, height: number, red: number, green = red, blue = red): RgbaImage {
  const data = new Uint8Array(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 4;
    data[offset] = red;
    data[offset + 1] = green;
    data[offset + 2] = blue;
    data[offset + 3] = 255;
  }
  return { width, height, data };
}

function paint(image: RgbaImage, index: number, red: number): RgbaImage {
  const data = new Uint8Array(image.data);
  data[index * 4] = red;
  return { ...image, data };
}

function encode(image: RgbaImage): Buffer {
  const png = new PNG({ width: image.width, height: image.height });
  png.data.set(image.data);
  return PNG.sync.write(png);
}

const same = solid(2, 2, 10);
assert.deepEqual(compareImages(same, same, null), compareImages(same, same, null));
assert.deepEqual(compareImages(same, same, null), { pass: true, ratio: 0 });

const within = paint(solid(1, 1, 0), 0, 16);
assert.equal(compareImages(within, solid(1, 1, 0), null).pass, true);
const over = paint(solid(1, 1, 0), 0, 17);
assert.equal(compareImages(over, solid(1, 1, 0), null).pass, false);

const base = solid(10, 10, 0);
let edge = base;
for (let index = 0; index < 2; index += 1) edge = paint(edge, index, 255);
const atLimit = compareImages(edge, base, null);
assert.deepEqual(atLimit, { pass: true, ratio: failRatio });
let overLimit = edge;
overLimit = paint(overLimit, 2, 255);
const failed = compareImages(overLimit, base, null);
assert.deepEqual(failed, { pass: false, message: diffMessage });

assert.deepEqual(compareImages(solid(2, 2, 0), solid(3, 2, 0), null), { pass: false, message: sizeMessage });

const mask = new Uint8Array(100);
mask.fill(255);
for (let index = 0; index < 21; index += 1) mask[index] = 0;
assert.equal(compareImages(overLimit, base, mask).pass, true);

assert.ok(buildMask([solid(2, 1, 1)]).every((value) => value === 255));
const masked = buildMask([solid(2, 1, 1), paint(solid(2, 1, 1), 1, 255)]);
assert.equal(masked[0], 255);
assert.equal(masked[1], 0);

for (const message of [diffMessage, sizeMessage]) {
  assert.equal(/Timeout|timeout|waiting for|앱 오류|Application error|로그인 화면으로 이동/.test(message), false);
}

const root = mkdtempSync(path.join(tmpdir(), "baseline-"));
try {
  clearPending(root);
  assert.deepEqual(readPending(root), []);
  const first = encode(solid(2, 2, 1));
  saveCandidate("홈", first, root);
  assert.equal(baselineState("홈", root), "candidate");
  assert.equal(confirmScenario("없는 화면", root), false);
  assert.equal(confirmScenario("홈", root), true);
  assert.equal(baselineState("홈", root), "ready");
  assert.deepEqual(readPending(root), []);

  const second = encode(paint(solid(2, 2, 1), 0, 255));
  saveCandidate("홈", second, root);
  assert.equal(confirmScenario("홈", root), true);
  const homeArchive = path.join(root, createHash("sha256").update("홈", "utf8").digest("hex").slice(0, 16), "archive");
  assert.equal(readdirSync(homeArchive).length, 2);

  for (let index = 0; index < archiveLimit + 1; index += 1) {
    saveCandidate("다른 화면", encode(solid(2, 2, index)), root);
    assert.equal(confirmScenario("다른 화면", root), true);
  }
  const otherArchive = path.join(root, createHash("sha256").update("다른 화면", "utf8").digest("hex").slice(0, 16), "archive");
  assert.equal(readdirSync(otherArchive).length, archiveLimit);

  saveCandidate("건너뜀", encode(solid(1, 1, 0)), root);
  const pendingFile = path.join(root, "pending.json");
  const pending = JSON.parse(await import("node:fs").then((fs) => fs.readFileSync(pendingFile, "utf8"))) as {
    names: string[];
  };
  pending.names.push("파일없음");
  await import("node:fs").then((fs) => fs.writeFileSync(pendingFile, JSON.stringify({ names: pending.names })));
  const confirmed = confirmPending(root);
  assert.equal(confirmed, 1);
  assert.deepEqual(readPending(root), ["파일없음"]);
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log("baseline ok");

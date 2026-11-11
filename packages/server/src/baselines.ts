import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { PNG } from "pngjs";

import { channelTolerance } from "@device-farm/core/baseline/diff";
import type { Device } from "@device-farm/core/device/types";
import type { ScreenScenario } from "@device-farm/core/scenarios";
import { baselineKey, deviceBaselinesRoot, pendingDeviceBaselines } from "@device-farm/engine/check";
import type { BaselineImages } from "@device-farm/engine/run";

const keyHashLength = 16;
/** 차이 없는 픽셀은 흐리게(작성자 판단) */
const fadeRatio = 0.3;
const channelMax = 255;

/**
 * store.ts의 scenarioDir와 같은 규칙. store.ts를 고치지 않고 여기서 같은 규칙을 쓴다.
 * store.ts가 바뀌면 같이 바꾼다.
 */
function baselineDir(key: string, root: string): string {
  const id = createHash("sha256").update(key, "utf8").digest("hex").slice(0, keyHashLength);
  return path.join(root, id);
}

/** 확정을 기다리는 후보 PNG. 후보 목록에 없는 이름은 null(아무 파일이나 읽지 않는다). */
export function candidatePng(key: string, root = deviceBaselinesRoot): Buffer | null {
  if (!pendingDeviceBaselines(root).includes(key)) return null;
  const file = path.join(baselineDir(key, root), "candidate.png");
  return existsSync(file) ? readFileSync(file) : null;
}

function differs(left: Buffer, right: Buffer, offset: number): boolean {
  for (let channel = 0; channel < 3; channel += 1) {
    if (Math.abs(left[offset + channel] - right[offset + channel]) > channelTolerance) return true;
  }
  return false;
}

/** 다른 픽셀은 빨강, 같은 픽셀은 이번 화면을 흐리게. 크기가 다르면 null. */
export function diffPng(current: Buffer, baseline: Buffer): Buffer | null {
  const now = PNG.sync.read(current);
  const base = PNG.sync.read(baseline);
  if (now.width !== base.width || now.height !== base.height) return null;
  const out = new PNG({ width: now.width, height: now.height });
  for (let offset = 0; offset < now.data.length; offset += 4) {
    const red = differs(now.data, base.data, offset);
    for (let channel = 0; channel < 3; channel += 1) {
      const faded = channelMax - (channelMax - now.data[offset + channel]) * fadeRatio;
      out.data[offset + channel] = red ? (channel === 0 ? channelMax : 0) : Math.round(faded);
    }
    out.data[offset + 3] = channelMax;
  }
  return PNG.sync.write(out);
}

/** 기준 비교로 실패한 화면의 기준·차이. 기준이 없거나 크기가 다르면 undefined. */
export function baselineFor(device: Device, scenario: ScreenScenario, screenshot: Buffer, root = deviceBaselinesRoot): BaselineImages | undefined {
  const file = path.join(baselineDir(baselineKey(device, scenario.name), root), "baseline.png");
  if (!existsSync(file)) return undefined;
  const baseline = readFileSync(file);
  const diff = diffPng(screenshot, baseline);
  return diff ? { baseline, diff } : undefined;
}

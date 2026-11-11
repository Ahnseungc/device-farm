import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

import type { DeviceLocks } from "@device-farm/core/device/lock";
import { devicesRoot } from "@device-farm/engine/results";

import type { ControlEntry } from "./types";

export const controlFile = path.join(devicesRoot, "control.jsonl");
/** 사람 잠금 자동 해제(expire)를 알아채는 주기 (작성자 판단) */
export const expireCheckMs = 30_000;

/**
 * 조작 기록 `control.jsonl`. lock을 적은 사람 잠금을 기억했다가, 잠금이 시간으로 풀리면 expire를 적는다.
 * 정지 함수가 있는 객체를 돌려준다.
 */
export function createControlLog(locks: DeviceLocks, file = controlFile, now: () => number = Date.now) {
  const held = new Map<string, string>();

  function append(entry: ControlEntry): void {
    mkdirSync(path.dirname(file), { recursive: true });
    appendFileSync(file, `${JSON.stringify(entry)}\n`);
  }

  function record(entry: Omit<ControlEntry, "at">): void {
    if (entry.action === "lock") held.set(entry.deviceId, entry.user);
    else held.delete(entry.deviceId);
    append({ at: now(), ...entry });
  }

  function checkExpired(): void {
    for (const [deviceId, user] of held) {
      const owner = locks.ownerOf(deviceId);
      if (owner?.kind === "user" && owner.user === user) continue;
      record({ user, deviceId, action: "expire" });
    }
  }

  const timer = setInterval(checkExpired, expireCheckMs);
  timer.unref();
  return { record, checkExpired, stop: () => clearInterval(timer) };
}

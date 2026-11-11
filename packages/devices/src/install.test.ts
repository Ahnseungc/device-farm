import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { Device } from "@device-farm/core/device/types";

import type { Exec } from "./exec";
import { installAndLaunch, installArgs, launchArgs } from "./install";

const android: Device = { id: "R3CN", platform: "android", model: "SM-S918N", osVersion: "14", appVersion: null };
const iphone: Device = { id: "00008110-AAAA", platform: "ios", model: "iPhone 15", osVersion: "18.6", appVersion: null };

assert.deepEqual(installArgs(android, "/c/a.apk"), ["adb", ["-s", "R3CN", "install", "-r", "/c/a.apk"]]);
assert.deepEqual(launchArgs(android, "app.id"), ["adb", ["-s", "R3CN", "shell", "monkey", "-p", "app.id", "1"]]);
assert.deepEqual(launchArgs(iphone, "app.id"), ["xcrun", ["devicectl", "device", "process", "launch", "--device", iphone.id, "app.id"]]);

const root = mkdtempSync(path.join(tmpdir(), "install-test-"));
try {
  const ipa = path.join(root, "ios-dev-2.1.5-412.ipa");
  const calls: string[][] = [];
  const exec: Exec = async (command, args) => {
    calls.push([command, ...args]);
    if (command === "unzip") mkdirSync(path.join(`${ipa}.d`, "Payload", "Runner.app"), { recursive: true });
    return "";
  };
  assert.deepEqual(await installAndLaunch(iphone, ipa, "com.example.shop.dev", exec), { ok: true });
  assert.deepEqual(calls[0], ["unzip", "-q", "-o", ipa, "-d", `${ipa}.d`]);
  assert.deepEqual(calls[1], ["xcrun", "devicectl", "device", "install", "app", "--device", iphone.id, path.join(`${ipa}.d`, "Payload", "Runner.app")]);
  assert.deepEqual(calls[2], ["xcrun", "devicectl", "device", "process", "launch", "--device", iphone.id, "com.example.shop.dev"]);

  const failing: Exec = async () => {
    throw new Error("Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE]");
  };
  assert.deepEqual(await installAndLaunch(android, "/c/a.apk", "com.example.shop", failing), {
    ok: false,
    message: "Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE]",
  });

  const emptyUnzip: Exec = async () => "";
  const broken = path.join(root, "broken.ipa");
  const result = await installAndLaunch(iphone, broken, "com.example.shop.dev", emptyUnzip);
  assert.equal(result.ok, false);
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log("install ok");

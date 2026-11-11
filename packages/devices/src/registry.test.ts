import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";

import type { Exec } from "./exec";
import { listDevices, parseAdbDevices, parseAndroidAppVersion, parseDevicectlAppVersion, parseDevicectlList, parseVersionName } from "./registry";

const appId = "com.example.shop.dev";

const devicectlFixture = JSON.stringify({
  result: {
    devices: [
      {
        hardwareProperties: { platform: "iOS", udid: "00008110-AAAA", marketingName: "iPhone 15" },
        deviceProperties: { osVersionNumber: "18.6" },
        connectionProperties: { tunnelState: "connected", transportType: "wired" },
      },
      {
        hardwareProperties: { platform: "iOS", udid: "00008110-BBBB", marketingName: "iPhone 12" },
        deviceProperties: { osVersionNumber: "17.5" },
        connectionProperties: { tunnelState: "unavailable" },
      },
      {
        // 2026-10-26 실측: 막 꽂은 iPhone 16. 유선인데 터널은 아직 안 열림
        hardwareProperties: { platform: "iOS", udid: "00008140-CCCC", marketingName: "iPhone 16" },
        deviceProperties: { osVersionNumber: "27.0.1" },
        connectionProperties: { tunnelState: "disconnected", transportType: "wired" },
      },
      {
        hardwareProperties: { platform: "iOS", udid: "00008140-DDDD", marketingName: "iPhone 16 Pro" },
        deviceProperties: { osVersionNumber: "27.0" },
        connectionProperties: { tunnelState: "disconnected", transportType: "localNetwork" },
      },
      {
        hardwareProperties: { platform: "watchOS", udid: "00008301-WATCH", marketingName: "Apple Watch Series 9" },
        deviceProperties: { osVersionNumber: "11.0" },
        connectionProperties: { tunnelState: "connected" },
      },
    ],
  },
});

assert.deepEqual(parseAdbDevices("List of devices attached\nR3CN\tdevice\nX1\tunauthorized\n"), ["R3CN"]);

const ios = parseDevicectlList(devicectlFixture);
assert.deepEqual(
  ios.map((device) => device.id),
  ["00008110-AAAA", "00008140-CCCC"],
);
assert.deepEqual(ios[0], { id: "00008110-AAAA", model: "iPhone 15", osVersion: "18.6" });

assert.equal(parseVersionName("Packages:\n  versionCode=412 minSdk=24\n  versionName=2.1.5\n"), "2.1.5");
assert.equal(parseVersionName("Unable to find package: x\n"), null);
assert.equal(parseDevicectlAppVersion(JSON.stringify({ result: { apps: [] } }), appId), null);
assert.equal(
  parseDevicectlAppVersion(JSON.stringify({ result: { apps: [{ bundleIdentifier: appId, version: "2.1.5", bundleVersion: "412" }] } }), appId),
  "2.1.5+412",
);
assert.equal(parseAndroidAppVersion("Packages:\n  versionCode=412 minSdk=24\n  versionName=2.0.18\n"), "2.0.18+412");

function writeJsonOutput(args: readonly string[], json: string): string {
  const file = args[args.indexOf("--json-output") + 1];
  writeFileSync(file, json);
  return "";
}

const fakeExec: Exec = async (command, args) => {
  if (command === "adb" && args[0] === "devices") return "List of devices attached\nR3CN\tdevice\n";
  if (command === "adb" && args.includes("ro.product.model")) return "SM-S918N\n";
  if (command === "adb" && args.includes("ro.build.version.release")) return "14\n";
  if (command === "adb" && args.includes("dumpsys")) return "Unable to find package\n";
  if (command === "xcrun" && args.includes("list")) return writeJsonOutput(args, devicectlFixture);
  if (command === "xcrun" && args.includes("apps")) {
    assert.ok(args.includes("--include-all-apps"), "스토어·Ad-hoc 앱도 보려면 --include-all-apps가 있어야 한다");
    return writeJsonOutput(args, JSON.stringify({ result: { apps: [{ bundleIdentifier: appId, version: "2.1.5" }] } }));
  }
  throw new Error(`unexpected ${command} ${args.join(" ")}`);
};

const devices = await listDevices(fakeExec, appId);
assert.equal(devices.length, 3);
assert.deepEqual(devices[0], { id: "R3CN", platform: "android", model: "SM-S918N", osVersion: "14", appVersion: null });
assert.equal(devices[1].platform, "ios");
assert.equal(devices[1].appVersion, "2.1.5");

console.log("registry ok");

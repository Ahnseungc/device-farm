import assert from "node:assert/strict";

import { parseInputEvent, toDevicePoint } from "@device-farm/core/device/input";

import {
  AccessUnitAssembler,
  AnnexBSplitter,
  androidInputArgs,
  avcCodecString,
  escapeInputText,
  nalType,
  parseWmSize,
} from "./android";
import { iosBackUnsupported, iosPointerActions, iosTapArgs } from "./ios";

const size = { width: 1080, height: 2400 };

// stream.md §6
assert.deepEqual(toDevicePoint({ x: 0.5, y: 0.5 }, size), { x: 540, y: 1200 });
assert.deepEqual(toDevicePoint({ x: 1.2, y: -1 }, size), { x: 1079, y: 0 });

// parseInputEvent
assert.deepEqual(parseInputEvent({ type: "tap", x: 0.1, y: 0.2, extra: 1 }), { type: "tap", x: 0.1, y: 0.2 });
assert.deepEqual(parseInputEvent({ type: "swipe", from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, durationMs: 300 }), {
  type: "swipe",
  from: { x: 0, y: 0 },
  to: { x: 1, y: 1 },
  durationMs: 300,
});
assert.deepEqual(parseInputEvent({ type: "text", text: "abc" }), { type: "text", text: "abc" });
assert.deepEqual(parseInputEvent({ type: "key", key: "home" }), { type: "key", key: "home" });
for (const bad of [
  null,
  "tap",
  [],
  { type: "tap", x: "1", y: 0 },
  { type: "tap", x: Number.NaN, y: 0 },
  { type: "swipe", from: { x: 0, y: 0 }, to: { x: 1 }, durationMs: 10 },
  { type: "swipe", from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, durationMs: -1 },
  { type: "text", text: "" },
  { type: "text", text: "a".repeat(1001) },
  { type: "key", key: "menu" },
  { type: "drag" },
]) {
  assert.equal(parseInputEvent(bad), null, JSON.stringify(bad));
}

// Android adb 인자
assert.deepEqual(androidInputArgs("S1", { type: "tap", x: 0.5, y: 0.5 }, size), ["-s", "S1", "shell", "input", "tap", "540", "1200"]);
assert.deepEqual(
  androidInputArgs("S1", { type: "swipe", from: { x: 0, y: 0.5 }, to: { x: 1, y: 0.5 }, durationMs: 250.4 }, size).slice(4),
  ["swipe", "0", "1200", "1079", "1200", "250"],
);
assert.deepEqual(androidInputArgs("S1", { type: "key", key: "back" }, size).slice(4), ["keyevent", "4"]);
assert.deepEqual(androidInputArgs("S1", { type: "key", key: "home" }, size).slice(4), ["keyevent", "3"]);
assert.equal(escapeInputText("it's me"), "'it'\\''s%sme'");
assert.throws(() => escapeInputText("안녕"));

// wm size
assert.deepEqual(parseWmSize("Physical size: 1080x2400\n"), size);
assert.deepEqual(parseWmSize("Physical size: 1440x3120\nOverride size: 1080x2340\n"), { width: 1080, height: 2340 });
assert.equal(parseWmSize("error"), null);

// Annex B → NAL → 프레임 패킷
const sps = Uint8Array.of(0, 0, 0, 1, 0x67, 0x42, 0xc0, 0x1f, 0xaa);
const pps = Uint8Array.of(0, 0, 1, 0x68, 0xce);
const idr = Uint8Array.of(0, 0, 0, 1, 0x65, 1, 2, 0, 3);
const slice = Uint8Array.of(0, 0, 0, 1, 0x41, 9);
const end = Uint8Array.of(0, 0, 0, 1, 0x41, 8);
const stream = Uint8Array.from([...sps, ...pps, ...idr, ...slice, ...idr, ...end]);
const splitter = new AnnexBSplitter();
const nals = [...splitter.push(stream.subarray(0, 7)), ...splitter.push(stream.subarray(7, 20)), ...splitter.push(stream.subarray(20))];
assert.deepEqual(nals.map(nalType), [7, 8, 5, 1, 5]);
assert.deepEqual([...nals[2]], [0, 0, 0, 1, 0x65, 1, 2, 0, 3]);
assert.equal(avcCodecString(nals[0]), "avc1.42C01F");

const assembler = new AccessUnitAssembler();
const packets = nals.map((nal) => assembler.push(nal)).filter((packet) => packet !== null);
assert.deepEqual(packets.map((packet) => packet.key), [true, false, true]);
// 두 번째 IDR(SPS·PPS 없이 옴)에도 SPS·PPS가 앞에 붙는다
const second = packets[2].packet;
assert.deepEqual([...second.subarray(0, 9)], [...sps]);
assert.equal(second[13], 0x68);

// iOS
const tap = iosPointerActions({ type: "tap", x: 0.5, y: 0.5 }, { width: 390, height: 844 });
assert.deepEqual(tap?.[0].actions[0], { type: "pointerMove", duration: 0, origin: "viewport", x: 195, y: 422 });
assert.deepEqual(tap?.[0].actions.map((step) => step.type), ["pointerMove", "pointerDown", "pause", "pointerUp"]);
const swipe = iosPointerActions({ type: "swipe", from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, durationMs: 300 }, { width: 390, height: 844 });
assert.deepEqual(swipe?.[0].actions[2], { type: "pointerMove", duration: 300, origin: "viewport", x: 389, y: 843 });
assert.equal(iosPointerActions({ type: "text", text: "a" }, { width: 1, height: 1 }), null);
assert.deepEqual(iosTapArgs({ type: "tap", x: 0.5, y: 0.5 }, { width: 393, height: 852 }), { x: 197, y: 426 });
assert.equal(iosTapArgs({ type: "key", key: "home" }, { width: 1, height: 1 }), null);
assert.equal(iosBackUnsupported, "iOS는 뒤로 키가 없습니다.");

console.log("input ok");

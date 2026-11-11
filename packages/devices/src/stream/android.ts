import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import { setTimeout as wait } from "node:timers/promises";

import { toDevicePoint, type InputEvent, type ScreenSize } from "@device-farm/core/device/input";

import { execFileText, type Exec } from "../exec";

// ponytail: scrcpy(@yume-chan/*) 대신 adb screenrecord + adb shell input.
// - @yume-chan 패키지가 더는 같은 버전으로 나오지 않아(adb 2.6.x, scrcpy 2.3.x, fetch-scrcpy-server 1.0.x) 스펙의 "같은 릴리스 고정"을 못 지킨다.
// - 대가: 영상 지연 약 0.3~0.5초, 입력은 adb shell 호출마다 0.1~0.3초 더 늦다. 키프레임 간격은 screenrecord 고정값(약 10초)이라 2초로 못 맞춘다.
//   screenrecord는 화면이 바뀔 때만 프레임을 내고 --time-limit(최대 180초)마다 끊겨 다시 띄운다.
// - 업그레이드 경로: @yume-chan/adb-scrcpy로 바꾸면 i-frame-interval=2와 제어 채널을 쓸 수 있다. 바깥 계약(openAndroidStream)은 그대로 둔다.

export const screenrecordBitRate = 4_000_000;
export const screenrecordTimeLimitSec = 180;
const restartDelayMs = 1_000;

const nalTypeMask = 0x1f;
const nalTypes = { idr: 5, sps: 7, pps: 8 } as const;
const firstVclType = 1;
const lastVclType = 5;
const startCode = Uint8Array.of(0, 0, 0, 1);
const startCodeLength = startCode.length;

export const androidKeyCodes = { back: 4, home: 3 } as const;

export interface AndroidStream {
  onVideo(cb: (packet: Uint8Array, key: boolean) => void): void;
  send(event: InputEvent): Promise<void>;
  size(): ScreenSize;
  /** WebCodecs 코덱 문자열(avc1.PPCCLL). 첫 SPS 전에는 null. */
  codec(): string | null;
  close(): Promise<void>;
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** `wm size` 출력 → 크기. Override가 있으면 그 값(입력 좌표가 그 기준이다). */
export function parseWmSize(stdout: string): ScreenSize | null {
  const pick = (label: string) => stdout.match(new RegExp(`${label} size:\\s*(\\d+)x(\\d+)`));
  const match = pick("Override") ?? pick("Physical");
  if (!match) return null;
  return { width: Number(match[1]), height: Number(match[2]) };
}

/** NAL 앞 start code 뒤 3바이트(profile·constraint·level) → `avc1.PPCCLL`. */
export function avcCodecString(sps: Uint8Array): string {
  const hex = (byte: number) => byte.toString(16).toUpperCase().padStart(2, "0");
  const header = startCodeLength;
  return `avc1.${hex(sps[header + 1])}${hex(sps[header + 2])}${hex(sps[header + 3])}`;
}

export function nalType(nal: Uint8Array): number {
  return nal[startCodeLength] & nalTypeMask;
}

/** start code 바로 뒤(NAL 헤더) 위치들. */
function findNalStarts(buffer: Uint8Array): number[] {
  const starts: number[] = [];
  for (let index = 0; index + 2 < buffer.length; index += 1) {
    if (buffer[index] === 0 && buffer[index + 1] === 0 && buffer[index + 2] === 1) {
      starts.push(index + 3);
      index += 2;
    }
  }
  return starts;
}

function withStartCode(payload: Uint8Array): Uint8Array {
  let end = payload.length;
  while (end > 0 && payload[end - 1] === 0) end -= 1; // 다음 4바이트 start code의 앞 0, trailing_zero
  return concatBytes([startCode, payload.subarray(0, end)]);
}

/** H.264 Annex B 바이트 흐름 → NAL 단위(4바이트 start code 포함). 마지막 조각은 다음 start code까지 들고 있다. */
export class AnnexBSplitter {
  private buffer: Uint8Array = new Uint8Array(0);

  push(chunk: Uint8Array): Uint8Array[] {
    this.buffer = concatBytes([this.buffer, chunk]);
    const starts = findNalStarts(this.buffer);
    if (starts.length < 2) return [];
    const nals = starts.slice(0, -1).map((start, index) => withStartCode(this.buffer.subarray(start, starts[index + 1] - 3)));
    this.buffer = this.buffer.slice(starts[starts.length - 1] - 3);
    return nals;
  }
}

export type VideoPacket = { packet: Uint8Array; key: boolean };

/**
 * NAL → 프레임 패킷. 슬라이스(VCL)가 오면 앞에 쌓인 SPS·PPS 등과 묶어 내보낸다.
 * screenrecord는 SPS·PPS를 처음 한 번만 내므로 IDR 앞에 마지막 SPS·PPS를 붙인다. 링버퍼가 중간 키프레임에서 시작해도 ffmpeg가 풀 수 있다.
 */
export class AccessUnitAssembler {
  private pending: Uint8Array[] = [];
  private sps: Uint8Array | null = null;
  private pps: Uint8Array | null = null;

  latestSps(): Uint8Array | null {
    return this.sps;
  }

  push(nal: Uint8Array): VideoPacket | null {
    const type = nalType(nal);
    if (type === nalTypes.sps) this.sps = nal;
    if (type === nalTypes.pps) this.pps = nal;
    this.pending.push(nal);
    if (type < firstVclType || type > lastVclType) return null;
    const parts = this.pending;
    this.pending = [];
    const key = type === nalTypes.idr;
    return { packet: concatBytes(key ? this.withParameterSets(parts) : parts), key };
  }

  private withParameterSets(parts: Uint8Array[]): Uint8Array[] {
    const has = (wanted: number) => parts.some((part) => nalType(part) === wanted);
    const prefix = [!has(nalTypes.sps) ? this.sps : null, !has(nalTypes.pps) ? this.pps : null].filter(
      (part): part is Uint8Array => part !== null,
    );
    return [...prefix, ...parts];
  }
}

const printableAscii = /^[\x20-\x7e]+$/;

/** `input text`용. 공백은 %s, 기기 sh가 해석하지 않게 작은따옴표로 감싼다. */
export function escapeInputText(text: string): string {
  if (!printableAscii.test(text)) throw new Error("Android 직접 입력은 영문·숫자·기호만 됩니다.");
  const spaced = text.replace(/ /g, "%s"); // ponytail: 원문 "%s"는 공백이 된다. 드문 입력이라 그대로 둔다.
  return `'${spaced.replace(/'/g, "'\\''")}'`;
}

/** InputEvent → `adb` 인자. 좌표는 비율이라 기기 픽셀로 바꾼다. */
export function androidInputArgs(serial: string, event: InputEvent, size: ScreenSize): string[] {
  const shell = ["-s", serial, "shell", "input"];
  if (event.type === "tap") {
    const point = toDevicePoint(event, size);
    return [...shell, "tap", String(point.x), String(point.y)];
  }
  if (event.type === "swipe") {
    const from = toDevicePoint(event.from, size);
    const to = toDevicePoint(event.to, size);
    return [...shell, "swipe", ...[from.x, from.y, to.x, to.y, Math.round(event.durationMs)].map(String)];
  }
  if (event.type === "text") return [...shell, "text", escapeInputText(event.text)];
  return [...shell, "keyevent", String(androidKeyCodes[event.key])];
}

export function screenrecordArgs(serial: string): string[] {
  return [
    "-s",
    serial,
    "exec-out",
    "screenrecord",
    "--output-format=h264",
    "--bit-rate",
    String(screenrecordBitRate),
    "--time-limit",
    String(screenrecordTimeLimitSec),
    "-",
  ];
}

async function readScreenSize(serial: string, exec: Exec): Promise<ScreenSize> {
  const stdout = await exec("adb", ["-s", serial, "shell", "wm", "size"]);
  const size = parseWmSize(stdout);
  if (!size) throw new Error(`${serial} 화면 크기를 읽지 못했습니다.`);
  return size;
}

type Recorder = ChildProcessByStdio<null, Readable, null>;

export interface AndroidStreamDeps {
  exec?: Exec;
  spawnRecorder?: (args: string[]) => Recorder;
}

const defaultSpawnRecorder = (args: string[]): Recorder => spawn("adb", args, { stdio: ["ignore", "pipe", "ignore"] });

// 실기기 확인: screenrecord가 exec-out stdout으로 H.264를 내는지, 3분마다 끊긴 뒤 재시작해도 브라우저 디코더가 이어 받는지.
// 실기기 확인: 탭·스와이프 좌표가 wm size(Override 포함) 기준으로 맞는지, 지연이 쓸 만한지.
export async function openAndroidStream(serial: string, deps: AndroidStreamDeps = {}): Promise<AndroidStream> {
  const exec = deps.exec ?? execFileText;
  const spawnRecorder = deps.spawnRecorder ?? defaultSpawnRecorder;
  const size = await readScreenSize(serial, exec);
  const listeners: Array<(packet: Uint8Array, key: boolean) => void> = [];
  const assembler = new AccessUnitAssembler();
  let recorder: Recorder | null = null;
  let closed = false;

  const emit = (nal: Uint8Array) => {
    const video = assembler.push(nal);
    if (video) for (const listener of listeners) listener(video.packet, video.key);
  };

  const start = () => {
    const splitter = new AnnexBSplitter();
    const child = spawnRecorder(screenrecordArgs(serial));
    recorder = child;
    child.stdout.on("data", (chunk: Buffer) => splitter.push(chunk).forEach(emit));
    let ended = false;
    // spawn 실패('error')든 3분 제한·기기 분리('close')든 1초 뒤 다시 띄운다. 기기가 빠져 있으면 1초마다 실패를 반복한다.
    const restart = async () => {
      if (ended || closed) return;
      ended = true;
      await wait(restartDelayMs);
      if (!closed) start();
    };
    child.on("error", restart);
    child.on("close", restart);
  };

  start();
  return {
    onVideo: (cb) => {
      listeners.push(cb);
    },
    send: async (event) => {
      await exec("adb", androidInputArgs(serial, event, size));
    },
    size: () => size,
    codec: () => {
      const sps = assembler.latestSps();
      return sps ? avcCodecString(sps) : null;
    },
    close: async () => {
      closed = true;
      recorder?.kill("SIGTERM");
      recorder = null;
    },
  };
}

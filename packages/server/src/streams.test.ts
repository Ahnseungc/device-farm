import assert from "node:assert/strict";

import type { AndroidStream } from "@device-farm/devices/stream/android";

import { createStreamHub, maxGopBytes, watchVideo } from "./streams";

// 이미 열린 스트림에 붙은 화면: 마지막 키프레임부터 지금까지를 받아 바로 그린다. 화면이 바뀐 뒤에 붙어도 마찬가지다
{
  let emit: (packet: Uint8Array, key: boolean) => void = () => undefined;
  const fake: AndroidStream = {
    onVideo: (cb) => void (emit = cb),
    send: async () => undefined,
    size: () => ({ width: 720, height: 1600 }),
    codec: () => "avc1.42C028",
    close: async () => undefined,
  };
  const hub = createStreamHub({ openAndroid: async () => fake });
  const sinkOf = () => {
    const got: string[] = [];
    return {
      got,
      sink: {
        header: (header: { codec: string }) => void got.push(`header ${header.codec}`),
        packet: (packet: Uint8Array, key: boolean) => void got.push(`${key ? "key" : "delta"} ${packet[0]}`),
      },
    };
  };
  const first = sinkOf();
  await watchVideo(hub, "A", first.sink);
  emit(Uint8Array.of(9), false); // 키프레임 전 조각은 버린다
  emit(Uint8Array.of(1), true);
  assert.deepEqual(first.got, ["header avc1.42C028", "key 1"]);

  const second = sinkOf();
  await watchVideo(hub, "A", second.sink);
  assert.deepEqual(second.got, ["header avc1.42C028", "key 1"]);

  emit(Uint8Array.of(2), false);
  const third = sinkOf();
  await watchVideo(hub, "A", third.sink);
  assert.deepEqual(third.got, ["header avc1.42C028", "key 1", "delta 2"]);

  // 새 키프레임이 오면 그 앞은 버린다
  emit(Uint8Array.of(3), true);
  const fourth = sinkOf();
  await watchVideo(hub, "A", fourth.sink);
  assert.deepEqual(fourth.got, ["header avc1.42C028", "key 3"]);

  // GOP가 한도를 넘으면 비우고 다음 키프레임을 기다린다
  emit(new Uint8Array(maxGopBytes), false);
  const fifth = sinkOf();
  await watchVideo(hub, "A", fifth.sink);
  assert.deepEqual(fifth.got, []);
  emit(Uint8Array.of(4), true);
  assert.deepEqual(fifth.got, ["header avc1.42C028", "key 4"]);
}

// 마지막 화면이 빠져도 잠깐은 녹화를 열어 둔다. 그 안에 다시 붙으면 새로 열지 않고, 지나면 닫는다
{
  let opened = 0;
  let closed = 0;
  const open = async (): Promise<AndroidStream> => {
    opened += 1;
    return { onVideo: () => undefined, send: async () => undefined, size: () => ({ width: 1, height: 1 }), codec: () => null, close: async () => void (closed += 1) };
  };
  const hub = createStreamHub({ openAndroid: open, lingerMs: 30 });
  const first = await hub.subscribe("A", () => undefined);
  first.unsubscribe();
  const second = await hub.subscribe("A", () => undefined);
  assert.equal(opened, 1, "목록 → 상세로 옮겨도 녹화를 다시 띄우지 않는다");
  second.unsubscribe();
  assert.equal(closed, 0);
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(closed, 1);
  await hub.subscribe("A", () => undefined);
  assert.equal(opened, 2, "닫힌 뒤에는 새로 연다");
}

console.log("streams ok");

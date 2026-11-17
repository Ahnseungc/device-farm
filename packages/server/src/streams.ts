import type { InputEvent } from "@device-farm/core/device/input";
import { appIdFor, type AppConfig } from "@device-farm/core/config/app-config";
import { getIosSession, isDeadSessionError, resetIosSession } from "@device-farm/devices/ios-session";
import { openAndroidStream, type AndroidStream } from "@device-farm/devices/stream/android";
import { openIosStream, type IosStream } from "@device-farm/devices/stream/ios";

import type { VideoSink } from "./types";

export type PacketListener = (packet: Uint8Array, key: boolean) => void;

interface AndroidEntry {
  stream: Promise<AndroidStream>;
  listeners: Set<PacketListener>;
  /**
   * 마지막 키프레임과 그 뒤 프레임들(GOP). 새로 붙은 화면에 그대로 보내 바로 지금 화면을 그린다.
   * screenrecord는 화면이 바뀔 때만 프레임을 내고 키프레임은 약 10초마다라, 키프레임만 들고 있으면
   * 그 뒤 화면이 한 번이라도 바뀐 경우 다음 키프레임까지(화면이 멈춰 있으면 끝없이) 비어 있었다(2026-11-17).
   */
  gop: Uint8Array[];
  gopBytes: number;
  /** 마지막 구독이 빠진 뒤 닫기를 미루는 타이머 */
  closeTimer?: ReturnType<typeof setTimeout>;
}

/**
 * 마지막 화면이 빠진 뒤 기기 녹화를 열어 두는 시간 (작성자 판단).
 * 목록 → 상세처럼 화면을 옮기면 앞 화면이 먼저 닫혀 녹화가 꺼지고, 새 화면이 녹화를 처음부터 다시 띄워 약 2초 「연결 중」이었다(2026-11-17).
 */
export const streamLingerMs = 60_000;

/** GOP를 들고 있는 최대 크기 (작성자 판단: 4Mbps 약 10초). 넘으면 비우고 다음 키프레임부터 다시 모은다 */
export const maxGopBytes = 8 * 1024 * 1024;

function remember(entry: Pick<AndroidEntry, "gop" | "gopBytes">, packet: Uint8Array, key: boolean): void {
  if (key) {
    entry.gop = [packet];
    entry.gopBytes = packet.length;
    return;
  }
  if (entry.gop.length === 0) return;
  if (entry.gopBytes + packet.length > maxGopBytes) {
    entry.gop = [];
    entry.gopBytes = 0;
    return;
  }
  entry.gop.push(packet);
  entry.gopBytes += packet.length;
}

export interface StreamHubDeps {
  /** iOS 입력 스트림이 쓰는 dev 앱 세션을 열 때 필요하다 */
  app?: AppConfig;
  openAndroid?: (serial: string) => Promise<AndroidStream>;
  lingerMs?: number;
  openIos?: (udid: string) => Promise<IosStream>;
}

export interface Subscription {
  stream: AndroidStream;
  unsubscribe: () => void;
  /** 붙을 때 바로 보낼 프레임들(마지막 키프레임부터). 비었으면 다음 키프레임을 기다린다 */
  replay: Uint8Array[];
}

const defaultOpenIos = (app: AppConfig | undefined) => async (udid: string) => {
  if (!app) throw new Error("앱 설정 없이 iOS 스트림을 열 수 없습니다.");
  return openIosStream(udid, await getIosSession(udid, appIdFor(app, "dev", "ios"), app.ios));
};

/**
 * 기기당 Android 스트림 하나를 화면(WebSocket)과 실패 영상 수집이 같이 쓴다. 마지막 구독이 빠지면 닫는다.
 * iOS는 입력용 스트림만 캐시한다(영상은 MJPEG 프록시).
 */
export function createStreamHub(deps: StreamHubDeps = {}) {
  const openAndroid = deps.openAndroid ?? ((serial: string) => openAndroidStream(serial));
  const openIos = deps.openIos ?? defaultOpenIos(deps.app);
  const lingerMs = deps.lingerMs ?? streamLingerMs;
  const android = new Map<string, AndroidEntry>();
  const ios = new Map<string, Promise<IosStream>>();

  function entryOf(serial: string): AndroidEntry {
    const existing = android.get(serial);
    if (existing) return existing;
    const listeners = new Set<PacketListener>();
    const entry = { listeners, gop: [], gopBytes: 0 } as Omit<AndroidEntry, "stream"> as AndroidEntry;
    entry.stream = openAndroid(serial).then((opened) => {
      opened.onVideo((packet, key) => {
        remember(entry, packet, key);
        listeners.forEach((listener) => listener(packet, key));
      });
      return opened;
    });
    const stream = entry.stream;
    android.set(serial, entry);
    // 열기 실패를 남겨 두면 다음 구독도 계속 실패하므로 지운다. 실패는 구독자에게 그대로 간다.
    stream.catch(() => {
      if (android.get(serial) === entry) android.delete(serial);
    });
    return entry;
  }

  async function subscribe(serial: string, listener: PacketListener): Promise<Subscription> {
    const entry = entryOf(serial);
    clearTimeout(entry.closeTimer);
    entry.closeTimer = undefined;
    entry.listeners.add(listener);
    let stream: AndroidStream;
    try {
      stream = await entry.stream;
    } catch (error) {
      entry.listeners.delete(listener);
      throw error;
    }
    const unsubscribe = () => {
      if (!entry.listeners.delete(listener) || entry.listeners.size > 0) return;
      clearTimeout(entry.closeTimer);
      entry.closeTimer = setTimeout(() => {
        entry.closeTimer = undefined;
        if (entry.listeners.size > 0) return;
        if (android.get(serial) === entry) android.delete(serial);
        void stream.close();
      }, lingerMs);
      entry.closeTimer.unref?.();
    };
    return { stream, unsubscribe, replay: [...entry.gop] };
  }

  function iosStream(udid: string): Promise<IosStream> {
    const existing = ios.get(udid);
    if (existing) return existing;
    const opening = openIos(udid);
    ios.set(udid, opening);
    opening.catch(() => {
      if (ios.get(udid) === opening) ios.delete(udid);
    });
    return opening;
  }

  async function sendAndroid(serial: string, event: InputEvent): Promise<void> {
    // 화면을 보고 있으면 열린 스트림을 쓴다. 아니면 잠깐 열었다 닫는다.
    const { stream, unsubscribe } = await subscribe(serial, () => undefined);
    try {
      await stream.send(event);
    } finally {
      unsubscribe();
    }
  }

  return {
    subscribe,
    sendAndroid,
    sendIos: async (udid: string, event: InputEvent) => {
      try {
        await (await iosStream(udid)).send(event);
      } catch (error) {
        if (!isDeadSessionError(error)) throw error;
        // 다른 프로세스가 세션을 가져갔거나 WDA가 다시 떴다. 세션·스트림을 새로 열어 한 번만 다시 보낸다.
        ios.delete(udid);
        await resetIosSession(udid);
        await (await iosStream(udid)).send(event);
      }
    },
    /** 앱 재설치로 Appium 세션을 새로 열었을 때. 다음 입력이 새 세션으로 스트림을 연다. */
    forgetIos: (udid: string) => {
      ios.delete(udid);
    },
  };
}

export type StreamHub = ReturnType<typeof createStreamHub>;

/** 화면 하나(WebSocket)의 영상 구독. 첫 키프레임에서 `{ codec, width, height }`를 먼저 보낸다. 해제 함수를 돌려준다. */
export async function watchVideo(hub: StreamHub, serial: string, sink: VideoSink): Promise<() => void> {
  let stream: AndroidStream | null = null;
  let sentHeader = false;
  const subscription = await hub.subscribe(serial, (packet, key) => {
    if (!sentHeader) {
      // 디코더는 키프레임부터 받아야 한다. 첫 SPS 전에는 코덱 문자열도 없다.
      const codec = stream?.codec();
      if (!key || !stream || !codec) return;
      sink.header({ codec, ...stream.size() });
      sentHeader = true;
    }
    sink.packet(packet, key);
  });
  stream = subscription.stream;
  // 이미 열린 스트림에 붙었으면 마지막 키프레임부터 지금까지를 보내 바로 지금 화면을 그린다
  const codec = stream.codec();
  if (!sentHeader && subscription.replay.length > 0 && codec) {
    sink.header({ codec, ...stream.size() });
    sentHeader = true;
    subscription.replay.forEach((packet, index) => sink.packet(packet, index === 0));
  }
  return subscription.unsubscribe;
}

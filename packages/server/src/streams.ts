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
}

export interface StreamHubDeps {
  /** iOS 입력 스트림이 쓰는 dev 앱 세션을 열 때 필요하다 */
  app?: AppConfig;
  openAndroid?: (serial: string) => Promise<AndroidStream>;
  openIos?: (udid: string) => Promise<IosStream>;
}

export interface Subscription {
  stream: AndroidStream;
  unsubscribe: () => void;
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
  const android = new Map<string, AndroidEntry>();
  const ios = new Map<string, Promise<IosStream>>();

  function entryOf(serial: string): AndroidEntry {
    const existing = android.get(serial);
    if (existing) return existing;
    const listeners = new Set<PacketListener>();
    const stream = openAndroid(serial).then((opened) => {
      opened.onVideo((packet, key) => listeners.forEach((listener) => listener(packet, key)));
      return opened;
    });
    const entry = { stream, listeners };
    android.set(serial, entry);
    // 열기 실패를 남겨 두면 다음 구독도 계속 실패하므로 지운다. 실패는 구독자에게 그대로 간다.
    stream.catch(() => {
      if (android.get(serial) === entry) android.delete(serial);
    });
    return entry;
  }

  async function subscribe(serial: string, listener: PacketListener): Promise<Subscription> {
    const entry = entryOf(serial);
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
      if (android.get(serial) === entry) android.delete(serial);
      void stream.close();
    };
    return { stream, unsubscribe };
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
    sink.packet(packet);
  });
  stream = subscription.stream;
  return subscription.unsubscribe;
}

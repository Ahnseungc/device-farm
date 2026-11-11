import { toDevicePoint, type InputEvent, type Point, type ScreenSize } from "@device-farm/core/device/input";

import { nativeContext } from "../ios-driver";
import { iosMjpegPort } from "../ios-session";

export const iosMjpegUrl = `http://127.0.0.1:${iosMjpegPort}`;
export const iosBackUnsupported = "iOS는 뒤로 키가 없습니다.";
const tapHoldMs = 50;
const fingerId = "finger1";

export interface IosStream {
  mjpegUrl: string;
  send(event: InputEvent): Promise<void>;
  /** NATIVE_APP 창 크기(포인트). W3C 좌표도 포인트라 toDevicePoint에 그대로 쓴다. */
  size(): ScreenSize;
  close(): Promise<void>;
}

type PointerStep =
  | { type: "pointerMove"; duration: number; x: number; y: number; origin: "viewport" }
  | { type: "pointerDown"; button: 0 }
  | { type: "pointerUp"; button: 0 }
  | { type: "pause"; duration: number };

export interface PointerAction {
  type: "pointer";
  id: string;
  parameters: { pointerType: "touch" };
  actions: PointerStep[];
}

const moveTo = (point: Point, duration: number): PointerStep => ({ type: "pointerMove", duration, origin: "viewport", ...point });

/** tap → `mobile: tap` 인자(포인트). 화면 종류(context)와 관계없이 WDA로 한 번에 간다. */
export function iosTapArgs(event: InputEvent, size: ScreenSize): Point | null {
  return event.type === "tap" ? toDevicePoint(event, size) : null;
}

/** tap·swipe → W3C performActions 본문. 다른 이벤트는 null. 스와이프만 쓴다. */
export function iosPointerActions(event: InputEvent, size: ScreenSize): PointerAction[] | null {
  const touch = (steps: PointerStep[]): PointerAction[] => [
    { type: "pointer", id: fingerId, parameters: { pointerType: "touch" }, actions: steps },
  ];
  if (event.type === "tap") {
    const point = toDevicePoint(event, size);
    return touch([moveTo(point, 0), { type: "pointerDown", button: 0 }, { type: "pause", duration: tapHoldMs }, { type: "pointerUp", button: 0 }]);
  }
  if (event.type === "swipe") {
    const from = toDevicePoint(event.from, size);
    const to = toDevicePoint(event.to, size);
    return touch([moveTo(from, 0), { type: "pointerDown", button: 0 }, moveTo(to, Math.round(event.durationMs)), { type: "pointerUp", button: 0 }]);
  }
  return null;
}

async function sendKey(session: WebdriverIO.Browser, key: "back" | "home"): Promise<void> {
  if (key === "back") throw new Error(iosBackUnsupported);
  await session.execute("mobile: pressButton", { name: "home" });
}

// 실기기 확인: performActions 좌표가 getWindowSize(포인트)와 맞는지, keys가 포커스된 WebView 입력칸에 들어가는지, MJPEG가 9100에서 나오는지.
export async function openIosStream(udid: string, session: WebdriverIO.Browser): Promise<IosStream> {
  await session.switchContext(nativeContext);
  const window = await session.getWindowSize();
  const size = { width: window.width, height: window.height };

  const send = async (event: InputEvent) => {
    if (event.type === "key") return sendKey(session, event.key);
    // 탭은 Appium 왕복 한 번. W3C actions(전환·실행·해제 세 번)보다 눈에 띄게 빠르다.
    const tap = iosTapArgs(event, size);
    if (tap) return void (await session.execute("mobile: tap", tap));
    // 점검과 조작은 잠금으로 번갈아 쓰므로, 조작 중에는 NATIVE_APP으로 돌려도 점검을 깨지 않는다.
    await session.switchContext(nativeContext);
    if (event.type === "text") return session.keys(event.text);
    const actions = iosPointerActions(event, size);
    if (!actions) throw new Error(`${udid}: 지원하지 않는 입력입니다.`);
    // pointerUp으로 끝나서 releaseActions 왕복은 뺀다.
    await session.performActions(actions);
  };

  return {
    mjpegUrl: iosMjpegUrl,
    send,
    size: () => size,
    // 세션은 상시 유지한다. 닫을 것은 없다.
    close: async () => undefined,
  };
}

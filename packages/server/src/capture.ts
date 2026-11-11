import type { ScreenDriver } from "@device-farm/core/device/driver";
import type { Device } from "@device-farm/core/device/types";
import { FrameRing, LogRing } from "@device-farm/core/logs/ring";
import { startCollectors } from "@device-farm/devices/logs/collect";
import { errorMessage, type DeviceCapture } from "@device-farm/engine/run";

import type { StreamHub } from "./streams";

/**
 * 점검·탐색 중 기기 로그와 영상을 30초 링버퍼에 담는다.
 * ponytail: iOS 영상(MJPEG 프레임)은 아직 안 담는다. 실패 묶음에 video.mp4가 없다. 필요하면 9100 MJPEG를 JPEG 단위로 잘라 FrameRing에 넣는다.
 */
export function createCapture(hub: StreamHub) {
  return async (device: Device, driver: ScreenDriver, appId: string): Promise<DeviceCapture> => {
    const ring = new LogRing();
    const frames = new FrameRing();
    const stopCollectors = await startCollectors(device, appId, driver, ring);
    let unsubscribe = () => {};
    if (device.platform === "android") {
      try {
        const subscription = await hub.subscribe(device.id, (packet, key) => frames.push(Buffer.from(packet), Date.now(), key));
        unsubscribe = subscription.unsubscribe;
      } catch (error) {
        ring.push({ source: "system", text: `영상 수집 실패: ${errorMessage(error)}` });
      }
    }
    return {
      ring,
      frames: () => frames.frames(),
      stop: async () => {
        unsubscribe();
        frames.clear();
        await stopCollectors();
      },
    };
  };
}

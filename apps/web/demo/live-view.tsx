import type { Device } from "@device-farm/core/device/types";

import { mjpegUrl } from "./api-client";

interface LiveViewProps {
  device: Device;
  width: number | string;
}

/** 데모 빌드의 기기 화면: 스트림 대신 가상 앱 화면 그림을 보인다(demo/vite.config.ts가 `./live-view`를 바꿔 끼운다) */
export function LiveView({ device, width }: LiveViewProps) {
  return <img className="devices-media" src={mjpegUrl(device.id)} alt={`${device.model} 화면 (데모)`} style={{ width }} draggable={false} />;
}

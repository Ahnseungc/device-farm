import { useEffect, useRef, useState, type CSSProperties } from "react";

import type { Device } from "@device-farm/core/device/types";

import { mjpegUrl, streamSocketUrl } from "./api-client";
import { t } from "./i18n";

type StreamHeader = { codec: string; width: number; height: number };

const nalTypeMask = 0x1f;
const nalTypeIdr = 5;
const nalTypeSps = 7;
const nalTypePps = 8;

/** Annex-B 패킷 안 NAL 단위 종류들. 시작 코드 `00 00 01`(4바이트 포함) 뒤 첫 바이트의 하위 5비트. */
export function nalTypes(packet: Uint8Array): number[] {
  const types: number[] = [];
  for (let index = 0; index + 3 < packet.length; index += 1) {
    if (packet[index] === 0 && packet[index + 1] === 0 && packet[index + 2] === 1) {
      types.push(packet[index + 3] & nalTypeMask);
      index += 2;
    }
  }
  return types;
}

function concat(first: Uint8Array, second: Uint8Array): Uint8Array {
  const merged = new Uint8Array(first.length + second.length);
  merged.set(first, 0);
  merged.set(second, first.length);
  return merged;
}

function parseHeader(text: string): StreamHeader | null {
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== "object" || value === null) return null;
    const { codec, width, height } = value as Record<string, unknown>;
    if (typeof codec !== "string" || typeof width !== "number" || typeof height !== "number") return null;
    return { codec, width, height };
  } catch {
    return null;
  }
}

interface LiveViewProps {
  device: Device;
  /** 격자 썸네일은 작게, 상세는 크게. 너비만 정하고 높이는 화면 비율을 따른다. */
  width: number | string;
}

export function LiveView({ device, width }: LiveViewProps) {
  const style: CSSProperties = { width };
  if (device.platform === "ios") {
    return (
      <img
        className="devices-media"
        src={mjpegUrl(device.id)}
        alt={`${device.model} ${t("실시간 화면", "live screen")}`}
        style={style}
        draggable={false}
      />
    );
  }
  return <AndroidCanvas deviceId={device.id} label={`${device.model} ${t("실시간 화면", "live screen")}`} style={style} />;
}

interface AndroidCanvasProps {
  deviceId: string;
  label: string;
  style: CSSProperties;
}

function AndroidCanvas({ deviceId, label, style }: AndroidCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState(() => t("연결 중", "Connecting"));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (typeof VideoDecoder === "undefined") {
      setStatus(t("이 브라우저는 WebCodecs를 지원하지 않습니다.", "This browser does not support WebCodecs."));
      return;
    }
    const context = canvas.getContext("2d");
    const socket = new WebSocket(streamSocketUrl(deviceId));
    socket.binaryType = "arraybuffer";
    let decoder: VideoDecoder | null = null;
    let pendingConfig: Uint8Array | null = null;
    let sawKey = false;
    let timestamp = 0;

    const draw = (frame: VideoFrame) => {
      if (canvas.width !== frame.displayWidth || canvas.height !== frame.displayHeight) {
        canvas.width = frame.displayWidth;
        canvas.height = frame.displayHeight;
      }
      context?.drawImage(frame, 0, 0, canvas.width, canvas.height);
      frame.close();
    };

    const configure = (header: StreamHeader) => {
      canvas.width = header.width;
      canvas.height = header.height;
      decoder = new VideoDecoder({ output: draw, error: (error) => setStatus(`${t("디코딩 오류", "Decode error")}: ${error.message}`) });
      // description 없이 구성하면 디코더가 Annex-B(시작 코드) 입력을 받는다.
      decoder.configure({ codec: header.codec, optimizeForLatency: true });
      setStatus("");
    };

    const feed = (raw: Uint8Array) => {
      if (!decoder || decoder.state !== "configured") return;
      const types = nalTypes(raw);
      const isConfigOnly = types.length > 0 && types.every((type) => type === nalTypeSps || type === nalTypePps);
      // scrcpy는 SPS/PPS를 따로 보낸다. 다음 키프레임 앞에 붙여야 디코더가 받는다.
      if (isConfigOnly) {
        pendingConfig = pendingConfig ? concat(pendingConfig, raw) : raw;
        return;
      }
      const isKey = types.includes(nalTypeIdr);
      if (!isKey && !sawKey) return;
      const data = isKey && pendingConfig ? concat(pendingConfig, raw) : raw;
      if (isKey) {
        pendingConfig = null;
        sawKey = true;
      }
      timestamp += 1;
      decoder.decode(new EncodedVideoChunk({ type: isKey ? "key" : "delta", timestamp, data }));
    };

    socket.onmessage = (message: MessageEvent<string | ArrayBuffer>) => {
      if (typeof message.data === "string") {
        const header = parseHeader(message.data);
        if (header) configure(header);
        else setStatus(t("스트림 첫 메시지를 읽지 못했습니다.", "Could not read the first stream message."));
        return;
      }
      try {
        feed(new Uint8Array(message.data));
      } catch (error) {
        setStatus(`${t("디코딩 오류", "Decode error")}: ${error instanceof Error ? error.message : String(error)}`);
      }
    };
    socket.onerror = () => setStatus(t("스트림에 연결하지 못했습니다.", "Could not connect to the stream."));
    socket.onclose = () => setStatus((current) => current || t("스트림이 끊겼습니다.", "The stream disconnected."));

    return () => {
      socket.onclose = null;
      socket.close();
      const active = decoder as VideoDecoder | null;
      if (active && active.state !== "closed") active.close();
    };
  }, [deviceId]);

  return (
    <div className="devices-live">
      <canvas
        ref={canvasRef}
        className="devices-media"
        data-ready={status === ""}
        role="img"
        aria-label={label}
        style={style}
      />
      {status ? (
        <span className="devices-live-status" role="status">
          {status}
        </span>
      ) : null}
    </div>
  );
}

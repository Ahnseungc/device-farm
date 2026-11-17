import { useEffect, useRef, useState, type CSSProperties } from "react";

import type { Device } from "@device-farm/core/device/types";

import { mjpegUrl, streamSocketUrl } from "./api-client";
import { t } from "./i18n";

type StreamHeader = { codec: string; width: number; height: number };

/**
 * 끊기면 다시 붙는 간격: 1초부터 회차마다 1초씩 늘려 10초까지 (작성자 판단). 횟수 제한은 없다 —
 * 호스트는 늘 켜져 있고, 5번에서 멈추면 서버 재시작·와이파이 끊김 뒤 화면이 새로고침 전까지 죽어 있었다(2026-11-17).
 */
const streamRetryMs = 1_000;
const maxStreamRetryMs = 10_000;

export function streamRetryDelay(retry: number): number {
  return Math.min(streamRetryMs * retry, maxStreamRetryMs);
}
/** 서버가 기기 스트림을 못 열면 이 코드와 이유로 닫는다(device-api attachStream) */
const serverErrorCloseCode = 1011;

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
    /** 이 화면이 닫혔다. 닫힌 연결의 오류·끊김이 새 연결 상태를 덮지 않게 한다(2026-11-17 「스트림에 연결하지 못했습니다」가 자주 뜸) */
    let disposed = false;
    let socket: WebSocket | null = null;
    let decoder: VideoDecoder | null = null;
    let retryTimer: number | undefined;
    let retries = 0;

    const draw = (frame: VideoFrame) => {
      if (canvas.width !== frame.displayWidth || canvas.height !== frame.displayHeight) {
        canvas.width = frame.displayWidth;
        canvas.height = frame.displayHeight;
      }
      context?.drawImage(frame, 0, 0, canvas.width, canvas.height);
      frame.close();
    };

    const closeDecoder = () => {
      const active = decoder as VideoDecoder | null;
      if (active && active.state !== "closed") active.close();
      decoder = null;
    };

    const connect = () => {
      let pendingConfig: Uint8Array | null = null;
      let sawKey = false;
      let timestamp = 0;
      let opened = false;
      const current = new WebSocket(streamSocketUrl(deviceId));
      socket = current;
      current.binaryType = "arraybuffer";

      const configure = (header: StreamHeader) => {
        canvas.width = header.width;
        canvas.height = header.height;
        closeDecoder();
        // 디코딩 오류(빠진 프레임 등)는 다시 붙어 키프레임부터 새로 받는다. 전엔 오류 문구에서 멈춰 있었다
        decoder = new VideoDecoder({ output: draw, error: () => restart() });
        // description 없이 구성하면 디코더가 Annex-B(시작 코드) 입력을 받는다.
        decoder.configure({ codec: header.codec, optimizeForLatency: true });
        retries = 0;
        setStatus("");
      };

      const restart = () => {
        if (disposed || socket !== current) return;
        current.close();
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

      // 서버가 첫 키프레임을 보내기 전(화면이 그대로면 10초 넘게 걸린다)에는 오류가 아니라 기다리는 중이다
      current.onopen = () => {
        opened = true;
        setStatus((status) => (status === "" ? status : t("화면 기다리는 중", "Waiting for the screen")));
      };
      current.onmessage = (message: MessageEvent<string | ArrayBuffer>) => {
        if (disposed || socket !== current) return;
        if (typeof message.data === "string") {
          const header = parseHeader(message.data);
          if (header) configure(header);
          else setStatus(t("스트림 첫 메시지를 읽지 못했습니다.", "Could not read the first stream message."));
          return;
        }
        try {
          feed(new Uint8Array(message.data));
        } catch {
          restart();
        }
      };
      // 오류 뒤에는 늘 close가 온다. 다시 붙이기는 close에서 한 번만 한다
      current.onerror = () => undefined;
      current.onclose = (event: CloseEvent) => {
        if (disposed || socket !== current) return;
        closeDecoder();
        // 서버가 이유를 적어 닫았으면(화면 녹화 시작 실패 등) 이유를 같이 보여 준다. 잠깐 실패일 수 있어 다시 붙여 본다
        const reason = event.code === serverErrorCloseCode && event.reason ? ` · ${event.reason}` : "";
        retries += 1;
        setStatus(
          opened
            ? t(`끊겨서 다시 연결 중 (${retries}번째)${reason}`, `Disconnected, reconnecting (attempt ${retries})${reason}`)
            : t(`연결이 안 돼 다시 연결 중 (${retries}번째)${reason}`, `Could not connect, retrying (attempt ${retries})${reason}`),
        );
        retryTimer = window.setTimeout(connect, streamRetryDelay(retries));
      };
    };

    connect();

    return () => {
      disposed = true;
      window.clearTimeout(retryTimer);
      socket?.close();
      closeDecoder();
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

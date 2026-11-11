import { useEffect, useRef, useState, type FormEvent, type PointerEvent } from "react";
import { IconChevronLeftLine } from "@karrotmarket/react-monochrome-icon";
import { PrefixIcon, Text, VStack } from "@seed-design/react";

import type { InputEvent, Point } from "@device-farm/core/device/input";

import { api, errorMessage, type DeviceWithState } from "./api-client";
import { StateChip } from "./devices-screen";
import { LiveView } from "./live-view";
import { ActionButton } from "./seed-design/ui/action-button";
import { Callout } from "./seed-design/ui/callout";
import { TextField, TextFieldInput } from "./seed-design/ui/text-field";

/** 이보다 덜 움직이면 탭. 화면 비율 기준. */
const tapDistanceRatio = 0.02;
const maxSwipeMs = 10_000;

type Gesture = { from: Point; startedAt: number };

function ratioPoint(event: PointerEvent<HTMLElement>): Point {
  const rect = event.currentTarget.getBoundingClientRect();
  return {
    x: Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1),
    y: Math.min(Math.max((event.clientY - rect.top) / rect.height, 0), 1),
  };
}

function toInputEvent(gesture: Gesture, to: Point, endedAt: number): InputEvent {
  const distance = Math.hypot(to.x - gesture.from.x, to.y - gesture.from.y);
  if (distance < tapDistanceRatio) return { type: "tap", x: gesture.from.x, y: gesture.from.y };
  const durationMs = Math.min(Math.round(endedAt - gesture.startedAt), maxSwipeMs);
  return { type: "swipe", from: gesture.from, to, durationMs };
}

interface DeviceDetailProps {
  device: DeviceWithState;
  onClose: () => void;
}

export function DeviceDetail({ device, onClose }: DeviceDetailProps) {
  const [locked, setLocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const gesture = useRef<Gesture | null>(null);
  const lockedRef = useRef(false);
  lockedRef.current = locked;

  // 화면을 떠날 때 잡은 잠금을 놓는다. 실패해도 서버가 만료시킨다.
  useEffect(() => {
    const id = device.id;
    return () => {
      if (lockedRef.current) void api.unlock(id).catch(() => undefined);
    };
  }, [device.id]);

  async function toggleLock() {
    setError(null);
    try {
      if (locked) await api.unlock(device.id);
      else await api.lock(device.id);
      setLocked(!locked);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  async function send(event: InputEvent) {
    setError(null);
    try {
      await Promise.all([api.touchLock(device.id), api.sendInput(device.id, event)]);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = { from: ratioPoint(event), startedAt: performance.now() };
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    const started = gesture.current;
    gesture.current = null;
    if (!started) return;
    void send(toInputEvent(started, ratioPoint(event), performance.now()));
  }

  function submitText(event: FormEvent) {
    event.preventDefault();
    if (!text) return;
    void send({ type: "text", text });
    setText("");
  }

  const offline = device.state === "offline";
  const isIos = device.platform === "ios";

  return (
    <VStack className="devices-page" gap="x5">
      <div className="devices-detail-header">
        <ActionButton variant="ghost" size="small" onClick={onClose}>
          <PrefixIcon svg={<IconChevronLeftLine />} />
          목록으로
        </ActionButton>
        <Text as="h2" textStyle="t6Bold" color="fg.neutral">
          {device.model} · {isIos ? "iOS" : "Android"} {device.osVersion}
        </Text>
        <StateChip state={device.state} />
      </div>

      <div className="devices-detail">
        <div
          className="devices-touch"
          data-locked={locked}
          onPointerDown={locked ? onPointerDown : undefined}
          onPointerUp={locked ? onPointerUp : undefined}
          onPointerCancel={() => (gesture.current = null)}
          aria-label="기기 화면. 조작 시작 후 클릭하면 탭, 끌면 스와이프"
        >
          {offline ? (
            <div className="devices-media-empty">
              <Text textStyle="t4Medium" color="fg.neutralSubtle">
                연결 끊김
              </Text>
            </div>
          ) : (
            <LiveView device={device} width="100%" />
          )}
        </div>

        {/* SEED Box 기본 스타일이 flex·min-width·배경을 덮어써서 카드 클래스는 바깥 div에 둔다 */}
        <div className="devices-card devices-controls">
          <VStack gap="x4">
            <VStack gap="x1">
              <Text as="h3" textStyle="t5Bold" color="fg.neutral">
                조작
              </Text>
              <Text as="p" textStyle="t3Regular" color="fg.neutralSubtle">
                설치 버전 {device.appVersion ?? "없음"}
              </Text>
            </VStack>
            <ActionButton
              variant={locked ? "neutralWeak" : "neutralSolid"}
              size="medium"
              onClick={() => void toggleLock()}
              disabled={offline}
            >
              {locked ? "조작 끝" : "조작 시작"}
            </ActionButton>
            <div className="devices-key-row">
              <ActionButton
                variant="neutralWeak"
                size="small"
                disabled={!locked || isIos}
                onClick={() => void send({ type: "key", key: "back" })}
              >
                뒤로
              </ActionButton>
              <ActionButton
                variant="neutralWeak"
                size="small"
                disabled={!locked}
                onClick={() => void send({ type: "key", key: "home" })}
              >
                홈
              </ActionButton>
            </div>
            {isIos ? <Callout tone="neutral" description="iOS는 뒤로 키가 없습니다." /> : null}
            <form className="devices-text-form" onSubmit={submitText}>
              <div className="devices-version">
                <TextField label="텍스트 입력" value={text} onValueChange={({ value }) => setText(value)} disabled={!locked}>
                  <TextFieldInput />
                </TextField>
              </div>
              <ActionButton type="submit" variant="neutralWeak" size="medium" disabled={!locked || !text}>
                보내기
              </ActionButton>
            </form>
            {error ? (
              <div role="alert">
                <Callout tone="critical" description={error} />
              </div>
            ) : null}
          </VStack>
        </div>
      </div>
    </VStack>
  );
}

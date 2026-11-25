import type { DevOverlayConfig } from "@device-farm/core/config/app-config";

/**
 * dev 빌드가 웹 위에 그리는 개발용 칩과 그 칩이 여는 미리보기(앱 설정 `android.devOverlay`).
 * 네이티브라 웹의 가림 확인(elementFromPoint)에 안 잡힌다. uiautomator 덤프로 자리를 읽는다.
 * 칩 옆 버튼을 누르다 칩이 눌리면 미리보기가 열려 뒤 화면들이 「기준 화면과 다릅니다」로 남는다.
 */

/** 화면 픽셀 상자 */
export type ScreenBox = { left: number; top: number; right: number; bottom: number };

/** 칩 둘레로 더 피하는 여유(px) (작성자 판단) */
const chipMargin = 8;
/** 미리보기 위쪽 두 글자가 놓이는 높이 한도(화면 비율) (작성자 판단) */
const previewTopRatio = 0.15;

interface DumpNode {
  label: string;
  clickable: boolean;
  box: ScreenBox;
}

const attr = (node: string, name: string) => new RegExp(` ${name}="([^"]*)"`).exec(node)?.[1] ?? "";

/** 덤프에 그려진 노드(자리가 있는 것만) */
function nodes(dump: string): DumpNode[] {
  const found: DumpNode[] = [];
  for (const [node] of dump.matchAll(/<node [^>]*>/g)) {
    const bounds = /^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/.exec(attr(node, "bounds"));
    if (!bounds) continue;
    const [left, top, right, bottom] = bounds.slice(1).map(Number);
    if (right <= left || bottom <= top) continue;
    found.push({ label: (attr(node, "content-desc") || attr(node, "text")).trim(), clickable: attr(node, "clickable") === "true", box: { left, top, right, bottom } });
  }
  return found;
}

/** 지금 화면의 개발용 칩 자리(여유 포함). 없으면(운영 빌드) 빈 목록 */
export function devChipBoxes(dump: string, config: DevOverlayConfig): ScreenBox[] {
  return nodes(dump)
    .filter((node) => config.chips.includes(node.label))
    .map(({ box }) => ({ left: box.left - chipMargin, top: box.top - chipMargin, right: box.right + chipMargin, bottom: box.bottom + chipMargin }));
}

/** 이 자리가 상자 안인가 */
export const inBoxes = (boxes: readonly ScreenBox[], x: number, y: number) => boxes.some((box) => x >= box.left && x <= box.right && y >= box.top && y <= box.bottom);

/**
 * 미리보기가 열려 있으면 닫기의 가운데. 칩이 있는 빌드에서 화면 맨 위 같은 줄에 두 글자가 함께 있을 때만 미리보기로 본다.
 */
export function devPreviewClosePoint(dump: string, config: DevOverlayConfig): { x: number; y: number } | null {
  const { preview } = config;
  if (!preview || devChipBoxes(dump, config).length === 0) return null;
  const all = nodes(dump);
  const height = Math.max(0, ...all.map((node) => node.box.bottom));
  const top = all.filter((node) => node.box.bottom <= height * previewTopRatio);
  for (const close of top.filter((node) => node.label === preview.close)) {
    const middle = (close.box.top + close.box.bottom) / 2;
    if (!top.some((node) => node.label === preview.marker && node.box.top <= middle && node.box.bottom >= middle)) continue;
    return { x: Math.round((close.box.left + close.box.right) / 2), y: Math.round(middle) };
  }
  return null;
}

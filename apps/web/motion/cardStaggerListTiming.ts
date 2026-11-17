import { ENTRANCE_STYLE_DURATION } from "./animations/entranceStyleMotion";

/** CardStaggerList footer 입장 시작(초) — 마지막 행 시작 + 행 길이 */
export function calcFooterEntranceDelay(
  itemCount: number,
  delayChildren: number,
  staggerChildren: number,
): number {
  if (itemCount === 0) {
    return delayChildren;
  }

  const lastItemStart = delayChildren + (itemCount - 1) * staggerChildren;
  return lastItemStart + ENTRANCE_STYLE_DURATION.list;
}

/** 입장 완료까지(ms). 이 뒤에 키를 "본 것"으로 기록한다 */
export function calcEntranceCompleteMs(
  enteringCount: number,
  delayChildren: number,
  staggerChildren: number,
  animateFooter: boolean,
  hasFooter: boolean,
  playFooterEntrance: boolean,
): number {
  const listDuration = ENTRANCE_STYLE_DURATION.list;

  if (hasFooter && animateFooter && playFooterEntrance) {
    return (
      (calcFooterEntranceDelay(enteringCount, delayChildren, staggerChildren) + listDuration) *
        1000 +
      50
    );
  }

  if (enteringCount === 0) {
    return 0;
  }

  return (delayChildren + (enteringCount - 1) * staggerChildren + listDuration) * 1000 + 50;
}

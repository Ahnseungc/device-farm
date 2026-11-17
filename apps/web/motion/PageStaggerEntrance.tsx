"use client";

import type { ReactNode } from "react";

import {
  PAGE_ENTRANCE_DELAY_CHILDREN_S,
  PAGE_ENTRANCE_STAGGER_S,
} from "./animations/pageEntranceMotion";
import { cn } from "./cn";

import { StaggeredEntrance } from "./StaggeredEntrance";

interface PageStaggerEntranceProps {
  children: ReactNode;
  /** 스태거 간격(초). 기본 0.045 */
  staggerChildren?: number;
  /** 첫 자식 전 delay(초). 기본 0 */
  delayChildren?: number;
  className?: string;
}

interface PageStaggerEntranceItemProps {
  children: ReactNode;
  className?: string;
}

/**
 * 탭 홈·랜딩 등 페이지 본문 블록을 위→아래로 연속 등장시키는 프리셋.
 * Server Component 자식을 children으로 넘기면 RSC 경계를 유지할 수 있다.
 */
export function PageStaggerEntrance({
  children,
  staggerChildren = PAGE_ENTRANCE_STAGGER_S,
  delayChildren = PAGE_ENTRANCE_DELAY_CHILDREN_S,
  className,
}: PageStaggerEntranceProps) {
  return (
    <StaggeredEntrance
      className={cn(className)}
      staggerChildren={staggerChildren}
      delayChildren={delayChildren}
    >
      {children}
    </StaggeredEntrance>
  );
}

/** Server Component에서도 사용 가능 — 정적 `Component.Item` 패턴은 RSC 경계에서 undefined가 된다. */
export function PageStaggerEntranceItem({
  children,
  className,
}: PageStaggerEntranceItemProps) {
  return (
    <StaggeredEntrance.Item variant="smoothDown" className={className}>
      {children}
    </StaggeredEntrance.Item>
  );
}

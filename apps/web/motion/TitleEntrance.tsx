"use client";

import {
  createContext,
  type ElementType,
  type ReactNode,
  useContext,
} from "react";

import { cn } from "./cn";

import { StaggeredEntrance } from "./StaggeredEntrance";

/** 토스 스타일 타이틀 줄 단위 스태거 — 등록/확인 화면 공통 */
export const TITLE_ENTRANCE_STAGGER_CHILDREN_S = 0.08;
export const TITLE_ENTRANCE_DELAY_CHILDREN_S = 0.05;

const TitleEntranceAnimateContext = createContext(true);

interface TitleEntranceProps {
  children: ReactNode;
  className?: string;
  /** 시맨틱 태그. 기본 h2 */
  as?: ElementType;
  staggerChildren?: number;
  delayChildren?: number;
  /**
   * false면 입장 모션 없이 즉시 표시.
   * 추가 입력 후 확인 화면 remount 시 타이틀 재재생 방지용.
   */
  animate?: boolean;
}

interface TitleEntranceLineProps {
  children: ReactNode;
  className?: string;
}

/**
 * 토스 스타일 다줄 타이틀 등장 애니메이션.
 * 줄마다 아래에서 살짝 올라오며 순차 등장한다.
 *
 * @example
 * <TitleEntrance className="text-h2-semibold text-text-default m-0">
 *   <TitleEntranceLine>입력한 귀금속의</TitleEntranceLine>
 *   <TitleEntranceLine>예상견적을 확인할까요?</TitleEntranceLine>
 * </TitleEntrance>
 */
export function TitleEntrance({
  children,
  className,
  as: Tag = "h2",
  staggerChildren = TITLE_ENTRANCE_STAGGER_CHILDREN_S,
  delayChildren = TITLE_ENTRANCE_DELAY_CHILDREN_S,
  animate = true,
}: TitleEntranceProps) {
  return (
    <TitleEntranceAnimateContext.Provider value={animate}>
      <Tag className={cn(className)}>
        {animate ? (
          <StaggeredEntrance
            staggerChildren={staggerChildren}
            delayChildren={delayChildren}
          >
            {children}
          </StaggeredEntrance>
        ) : (
          children
        )}
      </Tag>
    </TitleEntranceAnimateContext.Provider>
  );
}

/** 타이틀 한 줄 — fadeUp 스태거 아이템 */
export function TitleEntranceLine({
  children,
  className,
}: TitleEntranceLineProps) {
  const animate = useContext(TitleEntranceAnimateContext);
  if (!animate) {
    return <div className={cn("block", className)}>{children}</div>;
  }

  return (
    <StaggeredEntrance.Item variant="fadeUp" className={cn("block", className)}>
      {children}
    </StaggeredEntrance.Item>
  );
}

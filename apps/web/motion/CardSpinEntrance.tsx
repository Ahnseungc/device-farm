"use client";

import { type ReactNode, useEffect, useState } from "react";
import {
  type MotionValue,
  animate,
  motion,
  useMotionTemplate,
  useMotionValue,
  useReducedMotionConfig,
  useTransform,
} from "framer-motion";

import {
  CARD_SPIN_ENTRANCE_ANIMATE,
  CARD_SPIN_ENTRANCE_INITIAL,
  CARD_SPIN_ENTRANCE_PERSPECTIVE_PX,
  CARD_SPOTLIGHT_DIM,
  CARD_GLINT,
  CARD_GLINT_BACKGROUND_SIZE,
  CARD_GLINT_POSITION,
  CARD_SPIN_ENTRANCE_START_ROTATE_Y,
  cardSpinEntranceRotateTransition,
  cardSpinEntranceTransition,
  faceShadeOpacity,
  runWhenFramesSmooth,
} from "./animations/cardSpinEntranceMotion";
import { cn } from "./cn";

interface CardSpinEntranceProps {
  children: ReactNode;
  className?: string;
  /** 등장 delay(초) */
  delay?: number;
  /** 화면을 잠깐 어둡게 하고 자연광 반짝임과 함께 등장 (한 번 보여주는 히어로 카드용) */
  spotlight?: boolean;
  /** 등장 연출이 끝났을 때 1번 (spotlight 면 딤이 걷힌 뒤). 동작 줄이기 설정이면 바로 */
  onRevealed?: () => void;
  /** 카드 뒷면 — 출발할 때 보이고 반 바퀴 뒤집히며 앞면으로 바뀐다. 앞면과 같은 크기로 깔린다 */
  back?: ReactNode;
  /** 뒷면을 카드 모양으로 자른다 */
  radiusClassName?: string;
  /** 화면에 맞춘 최종 크기 배율 (레이아웃 보정은 호출부) */
  fitScale?: number;
}

/** 앞·뒷면 모두 등을 돌리면 숨긴다 (Safari 는 접두사 필요) */
const FACE_HIDDEN_BACK_STYLE = {
  backfaceVisibility: "hidden",
  WebkitBackfaceVisibility: "hidden",
} as const;
const BACK_FACE_STYLE = { ...FACE_HIDDEN_BACK_STYLE, transform: "rotateY(180deg)" } as const;
const BACK_FACE_OFFSET_DEG = 180;

/**
 * 코팅 카드에 맺힌 자연광 — 가운데 따뜻한 금빛, 바로 옆 아주 옅은 음영(흰 바탕에서도 빛이 지나가는 게 보이게).
 * 105° 로 살짝 기울여 위쪽 광원 느낌.
 */
const GLINT_GRADIENT = [
  "linear-gradient(105deg",
  "transparent 36%",
  "color-mix(in srgb, var(--color-fill-grayscale-black) 5%, transparent) 43%",
  "color-mix(in srgb, var(--color-fill-grayscale-white) 55%, transparent) 47.5%",
  "color-mix(in srgb, var(--color-fill-primary-bright) 95%, transparent) 50%",
  "color-mix(in srgb, var(--color-fill-grayscale-white) 55%, transparent) 52.5%",
  "color-mix(in srgb, var(--color-fill-grayscale-black) 5%, transparent) 57%",
  "transparent 64%)",
].join(", ");

/** 화면 전체 — PC 에서도 웹뷰 컬럼 폭으로 자르지 않는다 */
const SPOTLIGHT_DIM_CLASS = "z-overlay pointer-events-none fixed inset-0 bg-black";

function SpotlightDim({ delay, onDone }: { delay: number; onDone: () => void }) {
  return (
    <motion.div
      aria-hidden
      className={SPOTLIGHT_DIM_CLASS}
      initial={{ opacity: 0 }}
      animate={{ opacity: [...CARD_SPOTLIGHT_DIM.opacity] }}
      transition={{
        duration: CARD_SPOTLIGHT_DIM.durationS,
        times: [...CARD_SPOTLIGHT_DIM.times],
        delay,
      }}
      onAnimationComplete={onDone}
    />
  );
}

/** 면이 옆으로 돌아갈수록 어두워져 3D 로 도는 느낌을 준다 */
function FaceShade({
  rotateY,
  faceOffsetDeg,
}: {
  rotateY: MotionValue<number>;
  faceOffsetDeg: number;
}) {
  const opacity = useTransform(rotateY, (deg) => faceShadeOpacity(deg, faceOffsetDeg));
  return (
    <motion.div
      aria-hidden
      className='bg-fill-grayscale-black pointer-events-none absolute inset-0 z-20'
      style={{ opacity }}
    />
  );
}

/** 착지 뒤 천천히 한 번 지나가는 자연광 — 딤과 상관없이 끝까지 재생되고 카드 밖에서 멈춘다 */
function CardGlint({ delay }: { delay: number }) {
  const positionX = useMotionValue<number>(CARD_GLINT_POSITION.offLeft);
  const backgroundPositionX = useMotionTemplate`${positionX}%`;

  useEffect(() => {
    const controls = animate(positionX, CARD_GLINT_POSITION.offRight, {
      duration: CARD_GLINT.durationS,
      ease: CARD_GLINT.ease,
      delay: delay + CARD_GLINT.startAfterS,
    });
    return () => controls.stop();
  }, [delay, positionX]);

  return (
    <motion.div
      aria-hidden
      className='pointer-events-none absolute inset-0 z-10'
      style={{
        backgroundImage: GLINT_GRADIENT,
        backgroundSize: CARD_GLINT_BACKGROUND_SIZE,
        backgroundRepeat: "no-repeat",
        backgroundPositionX,
      }}
    />
  );
}

/**
 * 카드가 뒷면을 보인 채 아래에서 올라오며 커지고, 자리를 잡으면 Y축 반 바퀴 뒤집혀 앞면을 보여준다.
 * `back` 을 주면 도는 동안 뒷면이 보인다.
 * `spotlight` 면 그동안 화면이 어두워지고, 착지 뒤 자연광이 천천히 한 번 지나가고 딤이 걷힌다.
 * 착지는 스프링으로 살짝 넘쳤다 앉는다. 하이드레이션 직후 메인 스레드가 한가해진 뒤 시작한다.
 * 접근성: 동작 줄이기 설정이면 애니메이션 없이 그린다.
 */
export function CardSpinEntrance({
  children,
  className,
  delay = 0,
  spotlight = false,
  onRevealed,
  back,
  radiusClassName = "rounded-160",
  fitScale = 1,
}: CardSpinEntranceProps) {
  const shouldReduceMotion = useReducedMotionConfig();
  const rotateY = useMotionValue(CARD_SPIN_ENTRANCE_START_ROTATE_Y);
  const [isStarted, setIsStarted] = useState(false);
  // 딤이 걷히면 딤을 빼고 카드 z-index 를 푼다 — 남겨 두면 낮은 화면에서 하단 CTA 를 덮는다
  const [isSpotlightDone, setIsSpotlightDone] = useState(false);
  const showSpotlight = spotlight && !isSpotlightDone;

  useEffect(() => {
    if (shouldReduceMotion) onRevealed?.();
  }, [onRevealed, shouldReduceMotion]);

  useEffect(() => {
    if (shouldReduceMotion) return;
    return runWhenFramesSmooth(() => setIsStarted(true));
  }, [shouldReduceMotion]);

  useEffect(() => {
    if (shouldReduceMotion || !isStarted) return;
    const controls = animate(rotateY, 0, cardSpinEntranceRotateTransition(delay));
    return () => controls.stop();
  }, [delay, isStarted, rotateY, shouldReduceMotion]);

  const handleSpotlightDone = () => {
    setIsSpotlightDone(true);
    onRevealed?.();
  };

  if (shouldReduceMotion) {
    return (
      <div className={className} style={fitScale === 1 ? undefined : { scale: fitScale }}>
        {children}
      </div>
    );
  }

  return (
    <>
      {showSpotlight && isStarted ? (
        <SpotlightDim delay={delay} onDone={handleSpotlightDone} />
      ) : null}
      <div className={cn("relative", showSpotlight && "z-overlay-content")}>
        {/* 올라오기·커지기·나타나기 — opacity 가 1 미만이면 3D 가 평면화되므로 회전 레이어와 나눈다 */}
        <motion.div
          className='relative'
          initial={{
            ...CARD_SPIN_ENTRANCE_INITIAL,
            scale: CARD_SPIN_ENTRANCE_INITIAL.scale * fitScale,
          }}
          animate={isStarted ? { ...CARD_SPIN_ENTRANCE_ANIMATE, scale: fitScale } : undefined}
          transition={cardSpinEntranceTransition(delay)}
          onAnimationComplete={spotlight ? undefined : onRevealed}
        >
          {/* 회전 레이어엔 overflow·radius·opacity 를 두지 않는다 — 평면화되면 등을 돌린 면이 반전돼 비친다 */}
          <motion.div
            className='relative'
            style={{
              rotateY,
              transformPerspective: CARD_SPIN_ENTRANCE_PERSPECTIVE_PX,
              transformStyle: "preserve-3d",
              willChange: "transform",
            }}
          >
            <div
              className={cn("relative", className)}
              style={back ? FACE_HIDDEN_BACK_STYLE : undefined}
            >
              {children}
              {spotlight && isStarted ? <CardGlint delay={delay} /> : null}
              {back ? <FaceShade rotateY={rotateY} faceOffsetDeg={0} /> : null}
            </div>
            {back ? (
              <div
                aria-hidden
                className={cn("absolute inset-0 overflow-hidden", radiusClassName)}
                style={BACK_FACE_STYLE}
              >
                {back}
                <FaceShade rotateY={rotateY} faceOffsetDeg={BACK_FACE_OFFSET_DEG} />
              </div>
            ) : null}
          </motion.div>
        </motion.div>
      </div>
    </>
  );
}

/*
 * spring → 길이(초) + 이징 함수 — @toss/tds-spring-easing 0.0.1 `getSpringEasing` 을 옮겼다.
 * (패키지에 라이선스 표기 없음. 2026-11-04 사용자 승인으로 동작을 읽어 옮김)
 * TDS 와 같이 1/60초 간격 RK4 로 spring 을 풀고, 위치·속도가 0.01 안에 들면 멈춘 시간을 길이로 쓴다.
 * 변경: TDS 는 호출마다 처음부터 다시 풀지만, 여기서는 만들 때 한 번 풀어 표로 두고 보간한다 (rAF 카운트업에서 매 프레임 부른다)
 */

interface SpringConfig {
  stiffness: number;
  damping: number;
  mass?: number;
}

export interface SpringEasing {
  /** spring 이 멈추기까지 걸리는 시간(초) */
  durationS: number;
  /** 0~1 진행률 → 0~1 위치. 과감쇠 spring 이면 넘치지 않는다 */
  ease: (t: number) => number;
}

/** TDS 와 같은 적분 간격(초) */
const STEP_S = 1 / 60;
/** TDS 와 같은 정지 판단 — 목표와의 거리·속도가 이보다 작으면 멈춘 것으로 본다 */
const TOLERANCE = 0.01;
/** 무한 진동 방지 — 10초 넘게 안 멈추면 끊는다 */
const MAX_STEPS = 600;

interface State {
  x: number;
  v: number;
}

/** RK4 한 걸음 — 가속도 = -(k·x + c·v) / m */
function integrate(state: State, { stiffness, damping, mass = 1 }: SpringConfig): State {
  const accel = (x: number, v: number) => -(stiffness * x + damping * v) / mass;
  const a = { dx: state.v, dv: accel(state.x, state.v) };
  const b = {
    dx: state.v + a.dv * STEP_S * 0.5,
    dv: accel(state.x + a.dx * STEP_S * 0.5, state.v + a.dv * STEP_S * 0.5),
  };
  const c = {
    dx: state.v + b.dv * STEP_S * 0.5,
    dv: accel(state.x + b.dx * STEP_S * 0.5, state.v + b.dv * STEP_S * 0.5),
  };
  const d = {
    dx: state.v + c.dv * STEP_S,
    dv: accel(state.x + c.dx * STEP_S, state.v + c.dv * STEP_S),
  };
  return {
    x: state.x + ((a.dx + 2 * (b.dx + c.dx) + d.dx) / 6) * STEP_S,
    v: state.v + ((a.dv + 2 * (b.dv + c.dv) + d.dv) / 6) * STEP_S,
  };
}

/**
 * spring 설정을 시간 기반 이징으로 바꾼다 (TDS `springEaseWithDuration` 과 같은 결과).
 *
 * @example
 * const { ease, durationS } = createSpringEasing(MOTION_SPRING.basic);
 */
export function createSpringEasing(config: SpringConfig): SpringEasing {
  // 목표(1)에서 -1 만큼 떨어진 곳에서 출발해 0 으로 모인다 (TDS 와 같은 좌표)
  let state: State = { x: -1, v: 0 };
  const positions = [0];
  for (let step = 0; step < MAX_STEPS; step += 1) {
    state = integrate(state, config);
    positions.push(1 + state.x);
    if (Math.abs(state.x) < TOLERANCE && Math.abs(state.v) < TOLERANCE) break;
  }
  const lastIndex = positions.length - 1;

  const ease = (t: number) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    const exact = t * lastIndex;
    const index = Math.floor(exact);
    const from = positions[index];
    const to = positions[Math.min(index + 1, lastIndex)];
    return from + (to - from) * (exact - index);
  };

  return { durationS: lastIndex * STEP_S, ease };
}

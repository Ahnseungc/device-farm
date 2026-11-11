import type { Issue } from "../explore/probe";

/** 카오스 탐색 기록 한 스텝. engine이 쓰고 디바이스팜 화면이 읽는다. */
export interface ChaosStep {
  episode: number;
  step: number;
  at: string;
  from: string;
  /** 경로와 누를 수 있는 요소 이름으로 만든 상태 키 */
  state: string;
  /** 점수 높은 순 후보(상위 몇 개) */
  candidates: { key: string; score: number; probability: number }[];
  /** 고른 행동 키(`종류:역할:이름`) */
  chosen: string;
  chosenProbability: number;
  to: string;
  newState: boolean;
  dead: boolean;
  errors: Issue[];
  warnings: Issue[];
  failure?: string;
  /** 오류 스텝의 스크린샷 파일 이름(실행 폴더 기준) */
  screenshot?: string;
  /** 행동 뒤 다른 앱(광고·외부 링크 등)이 앞에 떴으면 그 패키지. 대상 앱으로 돌아와 이어 간다 */
  leftApp?: string;
}

export interface ChaosRun {
  runId: string;
  deviceId: string;
  seed: number;
  startedAt: string;
  finishedAt: string | null;
  steps: ChaosStep[];
  states: number;
  blocked: string[];
}

/** 실행 목록 한 줄 */
export interface ChaosRunSummary {
  runId: string;
  deviceId: string;
  seed: number;
  startedAt: string;
  finishedAt: string | null;
  steps: number;
  states: number;
  errorSteps: number;
  blocked: number;
}

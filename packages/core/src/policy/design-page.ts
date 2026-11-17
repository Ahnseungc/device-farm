// 「디자인 점검」 탭 계약. 서버(engine/policy/design-pages.ts)가 만들고 웹이 그린다

/** 「디자인 점검」 탭의 페이지 한 줄: 점검할 수 있는 화면과 마지막 결과 */
export interface DesignPage {
  path: string;
  /** 대조할 피그마 문구가 있는가. 없으면 정책 규칙만 본다 */
  hasFigma: boolean;
  rules: number;
  last: DesignResult | null;
}

export interface DesignResult {
  runId: string;
  /** 그 점검을 시작한 시각(ISO) */
  at: string;
  deviceId: string;
  status: string;
  /** 일치율: 화면 문구 중 피그마에 있는 비율 0~1. 피그마가 없거나 그 점검이 재지 않았으면 없다 */
  figmaCoverage?: number;
  /** 무시하지 않은 어긋남 수(피그마 문구 차이 포함) */
  mismatches: number;
  message?: string;
}

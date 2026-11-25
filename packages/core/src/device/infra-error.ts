/**
 * 기기·드라이버·연결 때문에 판정을 못 한 실패인지 본다.
 * 새 패턴은 실제 기록에서 본 문구만 넣는다. 앱이 바뀌어서도 나올 수 있는 문구(「홈 탭을 찾지 못함」 등)는
 * 넣지 않는다 — 진짜 앱 버그가 「점검 못 함」으로 숨는다.
 * 앞에 「N단계 … 실패: 」가 붙은 메시지도 잡도록 부분 문자열로 맞춘다.
 */

const flowTimeoutPattern = /플로우가 \d+분 안에 끝나지 않아/;

/** 점검기의 쓰기 차단이 플로우 요청을 막은 실패에 붙이는 머리말. 점검 못 함이다 */
export const blockedByFarmPrefix = "점검기가 막은 요청이 있어 판정하지 못함(";
export const blockedByFarmMessage = (request: string, message: string | undefined) => `${blockedByFarmPrefix}${request}) · ${message ?? ""}`;

/** 막혀도 플로우 결과와 무관한 요청. 바깥 주소는 전부 무관하다고 본다(허용 목록은 앱 서버만 다룬다). 앱 서버 것은 `guard.harmlessBlockedPatterns` (작성자 판단) */
export const isHarmlessBlocked = (path: string, patterns: readonly RegExp[]) => /^https?:\/\//.test(path) || patterns.some((pattern) => pattern.test(path));

/** 점검기가 보이지 않는 웹 화면을 읽고 있을 때 실패에 붙이는 머리말 */
export const hiddenPagePrefix = "보이지 않는 웹 화면을 읽고 있어 판정하지 못함 · ";
/** 개발용 칩이 누를 자리를 덮었을 때의 이유 */
export const devChipBlocked = "개발용 칩에 가려져 있습니다";

export const infraPatterns: readonly RegExp[] = [
  /웹 화면을 찾지 못했습니다/,
  /A session is either terminated or not started/,
  /화면에서 WebView 위치를/,
  flowTimeoutPattern,
  // 계정 상태(최소 적립량 미만 등)라 앱이 맞게 막은 것
  /계정 상태 때문에 점검할 수 없습니다/,
  // dev 서버 배포 중 502가 5분(`gatewayGiveUpMs`) 넘게 이어진 것.
  /웹 서버 오류 화면\(50[234] /,
  // 버튼 눌러보기의 쓰기 차단이 남아 플로우 요청을 막은 것.
  /점검기가 막은 요청이 있어 판정하지 못함\(/,
  // 같은 경로의 웹 화면이 둘이라 숨은 쪽을 읽은 것.
  /보이지 않는 웹 화면을 읽고 있어 판정하지 못함/,
  // dev 빌드 개발용 칩이 버튼을 덮은 것.
  /개발용 칩에 가려져 있습니다/,
];

export function isInfraFailure(message: string | undefined): boolean {
  if (!message) return false;
  return infraPatterns.some((pattern) => pattern.test(message));
}

/** 플로우 시간 제한(10분)으로 멈춘 실패. 다시 돌리면 한 개에 20분이 되어 다시 돌리지 않는다 */
export function isFlowTimeout(message: string | undefined): boolean {
  return message != null && flowTimeoutPattern.test(message);
}

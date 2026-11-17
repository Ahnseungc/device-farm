/**
 * 슬랙에 보내는 오류를 사람이 읽는 한국어로 푼다(specs/README.md 「오류 문구」).
 * 기기·Appium·adb·Firebase·GitHub·git·Claude가 낸 영어·기술 문구를 「무슨 일 · 무엇을 하면 되는지」로 바꾼다.
 * 이미 한국어인 문구는 그대로 둔다. 모르는 영어 문구는 「점검기 오류」로 감싸고 원문 앞부분만 붙인다.
 */

interface Rule {
  test: RegExp;
  /** 원문에서 뽑은 값으로 문장을 만든다 */
  say: (match: RegExpExecArray) => string;
}

const fileName = (file: string) => file.split("/").pop() ?? file;

/** 위에서부터 처음 맞는 것 하나 (작성자 판단: 자주 본 것 먼저) */
const rules: Rule[] = [
  {
    test: /Unable to connect to "?https?:\/\/[^"\s]*:4723|browser driver is running|connect ECONNREFUSED [\d.]+:4723/i,
    say: () => "기기를 조종하는 프로그램(Appium)이 꺼져 있어 점검을 못 했어요. 디바이스팜 맥에서 Appium이 켜져 있는지 확인해 주세요.",
  },
  {
    test: /device (?:'[^']*' )?not found|no devices\/emulators found|device offline|device '?[^']*'? is offline|기기가 연결되어 있지 않/i,
    say: () => "기기가 디바이스팜 맥에 연결되어 있지 않아요. USB 케이블이 꽂혀 있는지, 기기 화면에 뜬 「USB 디버깅 허용」을 눌렀는지 확인해 주세요.",
  },
  {
    test: /\bdevice unauthorized\b|adb: unauthorized|\bunauthorized$/im,
    say: () => "기기가 디바이스팜 맥을 아직 믿지 않아요. 기기 화면에 뜬 「USB 디버깅 허용」(아이폰은 「이 컴퓨터 신뢰」)을 눌러 주세요.",
  },
  {
    test: /INSTALL_FAILED_VERSION_DOWNGRADE/,
    say: () => "기기에 더 새 버전의 앱이 깔려 있어서 이 빌드를 설치하지 못했어요. 기기에서 앱을 지운 뒤 다시 점검해 주세요.",
  },
  {
    test: /INSTALL_FAILED_INSUFFICIENT_STORAGE|not enough (?:free )?space/i,
    say: () => "기기 저장 공간이 모자라 앱을 설치하지 못했어요. 기기에서 안 쓰는 앱·사진을 지워 주세요.",
  },
  {
    test: /INSTALL_FAILED_[A-Z_]+|adb: failed to install/,
    say: () => "기기에 앱을 설치하지 못했어요. 기기에서 앱을 지운 뒤 다시 점검해 주세요.",
  },
  {
    test: /ENOENT[^']*'([^']*firebase[^']*)'/i,
    say: (match) => `Firebase 접속 정보 파일(${fileName(match[1])})이 디바이스팜 맥에 없어 빌드를 받지 못했어요. 디바이스팜 설정을 확인해 주세요.`,
  },
  {
    test: /The caller does not have permission|PERMISSION_DENIED/,
    say: () => "Firebase에서 권한이 없다고 해 빌드 목록을 읽지 못했어요. 디바이스팜 서비스 계정 권한을 확인해 주세요.",
  },
  {
    test: /WebDriverAgent|xcodebuild failed|Could not start a new WDA/i,
    say: () => "아이폰을 조종하는 프로그램(WebDriverAgent)을 띄우지 못했어요. 아이폰 잠금을 풀고 「이 컴퓨터 신뢰」·개발자 모드가 켜져 있는지 확인해 주세요.",
  },
  {
    test: /device is locked|screen is locked|Passcode/i,
    say: () => "기기 화면이 잠겨 있어 점검을 못 했어요. 기기 잠금을 풀어 주세요.",
  },
  {
    test: /A new session could not be created|session not created|invalid session id/i,
    say: () => "기기를 조종하는 연결을 열지 못했어요. 기기 연결과 Appium을 확인한 뒤 다시 점검해 주세요.",
  },
  {
    test: /GitHub \S+ \S+ 401|Bad credentials/i,
    say: () => "GitHub 토큰이 맞지 않거나 만료됐어요. 디바이스팜 맥 .env의 FARM_FIX_PR_GITHUB_TOKEN을 새로 넣어 주세요.",
  },
  {
    test: /GitHub \S+ \S+ (?:403|404)|Resource not accessible|Permission to \S+ denied|returned error: 403/i,
    say: () => "GitHub 토큰에 이 레포를 고칠 권한이 없어요. 토큰의 레포·권한(Contents·Pull requests 쓰기)을 확인해 주세요.",
  },
  {
    test: /GitHub \S+ \S+ 422.*(?:already exists|No commits between)/i,
    say: () => "같은 브랜치의 PR이 이미 있거나 올릴 변경이 없어 PR을 열지 않았어요.",
  },
  {
    test: /\[rejected\]|non-fast-forward|fetch first|Updates were rejected/i,
    say: () => "GitHub에 먼저 올라간 커밋이 있어 올리지 못했어요. 디바이스팜 맥에서 원격 변경을 받아 합친 뒤 올려야 해요(커밋은 이 맥에 남아 있어요).",
  },
  {
    test: /Could not resolve host|getaddrinfo ENOTFOUND|ENETUNREACH|network is unreachable/i,
    say: () => "인터넷에 연결되지 않아요. 디바이스팜 맥의 와이파이를 확인해 주세요.",
  },
  {
    test: /Claude[^\n]*(?:log ?in|logged in|auth)|Invalid API key|OAuth token/i,
    say: () => "디바이스팜 맥의 Claude 로그인이 풀렸어요. 디바이스팜 맥에서 `claude setup-token`을 한 뒤 .env CLAUDE_CODE_OAUTH_TOKEN을 바꿔 주세요.",
  },
  {
    test: /ETIMEDOUT|timed? ?out|timeout/i,
    say: () => "응답이 너무 늦어 시간 초과로 멈췄어요. 잠시 뒤 다시 해 보고, 계속되면 기기 연결을 확인해 주세요.",
  },
  {
    test: /ECONNRESET|socket hang up|EPIPE/i,
    say: () => "연결이 중간에 끊겼어요. 잠시 뒤 다시 해 주세요.",
  },
  {
    test: /ENOENT[^']*'([^']+)'/,
    say: (match) => `필요한 파일(${fileName(match[1])})이 디바이스팜 맥에 없어요.`,
  },
];

const hangul = /[가-힣]/g;
const latinWord = /[A-Za-z]{3,}/g;

/** 한국어 문장이 주인 문구인지(글자 수로 본다) */
function isMostlyKorean(text: string): boolean {
  const korean = text.match(hangul)?.length ?? 0;
  const latin = (text.match(latinWord) ?? []).join("").length;
  return korean > 0 && korean >= latin;
}

/** 원문 앞부분(한 줄, 경로는 파일 이름만) */
const rawHead = (text: string, length = 120) => {
  const line = text.replace(/\/(?:Users|private|var|tmp)\/\S+/g, (file) => fileName(file)).replace(/\s+/g, " ").trim();
  return line.length > length ? `${line.slice(0, length)}…` : line;
};

/**
 * 슬랙에 그대로 보여 줄 한국어 문구. 아는 오류면 풀어 쓴 문장, 이미 한국어면 그대로,
 * 모르는 영어 오류면 「점검기 오류가 났어요」와 원문 앞부분.
 */
export function plainError(message: string | undefined | null): string {
  const text = (message ?? "").trim();
  if (!text) return "";
  // 점검기가 쓴 한국어 문구(「홈」 링크를 찾지 못했습니다 등)는 이미 읽을 수 있다
  if (isMostlyKorean(text)) return text;
  for (const rule of rules) {
    const match = rule.test.exec(text);
    if (match) return rule.say(match);
  }
  return `디바이스팜이 처음 보는 오류가 났어요. 결과 탭의 로그를 확인해 주세요. (원문: ${rawHead(text)})`;
}

/** 기기 점검 결과 상태(`OutcomeStatus`) → 한국어 */
export const outcomeStatusLabels: Record<string, string> = {
  running: "점검 중",
  passed: "통과",
  failed: "실패",
  skipped: "건너뜀",
  install_failed: "앱 설치 실패",
  login_required: "로그인 필요",
  offline: "기기가 연결되어 있지 않아요",
};

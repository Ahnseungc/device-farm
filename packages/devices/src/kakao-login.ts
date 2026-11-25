import type { KakaoLoginConfig, PixelProbe } from "@device-farm/core/config/app-config";

/** 색이 이만큼 안이면 같은 색으로 본다 (작성자 판단) */
const colorTolerance = 14;

/** 카카오 계정 선택 페이지(Chrome 커스텀 탭) 주소 */
export const kakaoAccountsHost = "accounts.kakao.com";

export interface Screenshot {
  width: number;
  height: number;
  /** RGBA */
  data: Uint8Array;
}

export type LoginScreen = "login" | "notice" | "other";

function matches(shot: Screenshot, probes: readonly PixelProbe[]): boolean {
  return probes.every(({ x, y, rgb }) => {
    const index = (shot.width * Math.round(shot.height * y) + Math.round(shot.width * x)) * 4;
    return rgb.every((value, channel) => Math.abs(shot.data[index + channel] - value) <= colorTolerance);
  });
}

/** 지금 화면이 앱 로그인 화면인가(안내 팝업이 덮었나) */
export function loginScreenOf(shot: Screenshot, config: KakaoLoginConfig): LoginScreen {
  if (config.probes.length > 0 && matches(shot, config.probes)) return "login";
  if (config.notice && config.notice.probes.length > 0 && matches(shot, config.notice.probes)) return "notice";
  return "other";
}

/**
 * 카카오 계정 선택 페이지에서 이미 로그인된 계정을 누르는 스크립트. 누른 계정 글자(이메일 등), 없으면 null.
 * 「새로운 계정으로 로그인」과 계정 지우기(X)는 누르지 않는다. 비밀번호는 넣지 않는다.
 */
export const selectKakaoAccountScript = `(() => {
  const squash = (s) => String(s || "").replace(/\\s+/g, " ").trim();
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const avoid = (el) => /새로운 계정|다른 계정|삭제|지우기|remove|delete/i.test(squash(el.innerText) + " " + (el.getAttribute("aria-label") || "") + " " + String(el.className));
  const items = Array.from(document.querySelectorAll('a, button, [role="button"], li')).filter((el) => visible(el) && !avoid(el) && /@|\\d{3}-?\\d{4}/.test(squash(el.innerText)));
  // 가장 안쪽 것(계정 한 줄)
  const target = items.find((el) => !items.some((other) => other !== el && el.contains(other)));
  if (!target) return null;
  target.click();
  return squash(target.innerText).split(" ")[0] || "계정";
})()`;

export interface KakaoLoginDeps {
  /** 기기 전체 화면 PNG를 읽은 것 */
  screenshot: () => Promise<Screenshot>;
  tap: (x: number, y: number) => Promise<void>;
  /** 포커스된 창 `<package>/<activity>` */
  focus: () => Promise<string>;
  /** Chrome 카카오 계정 선택 페이지에서 계정을 누른다. 그 페이지가 없으면 null, 계정이 없으면 throw */
  selectAccount: () => Promise<string | null>;
  /** 앱 웹 화면이 다시 붙었나(로그인 끝) */
  appReady: () => Promise<boolean>;
  sleep: (ms: number) => Promise<void>;
  now?: () => number;
  log?: (message: string) => void;
}

/** 시간 (작성자 판단) */
export const kakaoLoginTimes = { settleMs: 1_500, pickerWaitMs: 15_000, readyWaitMs: 30_000, pollMs: 1_000 } as const;

export type KakaoLoginResult = "not-login" | "logged-in";

/**
 * 로그아웃돼 앱 로그인 화면이면 「카카오로 시작하기」 → 이미 로그인된 카카오 계정을 골라 다시 로그인한다.
 * 로그인 화면이 아니면 아무것도 누르지 않고 "not-login". 색으로 화면을 확인한 뒤에만 누른다(모르는 화면을 좌표로 누르지 않는다).
 */
export async function reloginWithKakao(config: KakaoLoginConfig, deps: KakaoLoginDeps, times: Record<keyof typeof kakaoLoginTimes, number> = kakaoLoginTimes): Promise<KakaoLoginResult> {
  const now = deps.now ?? Date.now;
  const tapRatio = async (point: { x: number; y: number }) => {
    const shot = await deps.screenshot();
    await deps.tap(Math.round(shot.width * point.x), Math.round(shot.height * point.y));
  };

  let screen = loginScreenOf(await deps.screenshot(), config);
  if (screen === "notice" && config.notice) {
    await tapRatio(config.notice.closeButton);
    await deps.sleep(times.settleMs);
    screen = loginScreenOf(await deps.screenshot(), config);
  }
  if (screen !== "login") return "not-login";
  deps.log?.("로그아웃돼 있어 카카오로 다시 로그인합니다.");
  await tapRatio(config.button);

  // 계정 선택 페이지(Chrome)가 뜨면 계정을 누른다. 카카오가 기억하면 선택 없이 바로 앱으로 돌아온다
  const pickerDeadline = now() + times.pickerWaitMs;
  let picked: string | null = null;
  while (now() < pickerDeadline) {
    await deps.sleep(times.pollMs);
    if (await deps.appReady()) return "logged-in";
    if ((await deps.focus()).startsWith("com.android.chrome/")) {
      picked = await deps.selectAccount();
      if (picked) break;
    }
  }
  if (!picked && !(await deps.appReady())) {
    throw new Error("「카카오로 시작하기」를 눌렀지만 고를 카카오 계정이 없었습니다(계정 선택 화면이 안 떴거나, 기기에 저장된 카카오 계정이 없음).");
  }

  const readyDeadline = now() + times.readyWaitMs;
  while (!(await deps.appReady())) {
    if (now() >= readyDeadline) throw new Error("카카오 계정을 골랐지만 앱 화면으로 돌아오지 않았습니다(동의 화면 등 확인 필요).");
    await deps.sleep(times.pollMs);
  }
  deps.log?.("카카오로 다시 로그인했습니다.");
  return "logged-in";
}

/**
 * 앱 알림 권한 창(「<앱 이름>에서 알림을 보내도록 허용하시겠습니까?」)의 「허용」 가운데. 다른 권한 창이면 null.
 * 앱 데이터가 지워진 뒤 로그인하면 뜬다.
 */
export function notificationAllowPoint(dump: string, appLabel: string): { x: number; y: number } | null {
  const message = /resource-id="com\.android\.permissioncontroller:id\/permission_message"/.test(dump) ? /text="([^"]*)"[^>]*resource-id="com\.android\.permissioncontroller:id\/permission_message"/.exec(dump)?.[1] ?? "" : "";
  if (!message.includes(appLabel) || !message.includes("알림을 보내도록 허용")) return null;
  const allow = /<node [^>]*resource-id="com\.android\.permissioncontroller:id\/permission_allow_button"[^>]*>/.exec(dump)?.[0];
  const bounds = allow && /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(allow);
  if (!bounds) return null;
  const [left, top, right, bottom] = bounds.slice(1).map(Number);
  return { x: Math.round((left + right) / 2), y: Math.round((top + bottom) / 2) };
}

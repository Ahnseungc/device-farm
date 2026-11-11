import { remote } from "webdriverio";

export const defaultAppiumUrl = "http://127.0.0.1:4723";
export const iosMjpegPort = 9100;
/** Appium이 명령 없이 기다리다 세션을 닫는 시간(초) (작성자 판단) */
export const iosNewCommandTimeoutSec = 600;
/**
 * WDA MJPEG 기본값(초당 10장, 원본 해상도, 장당 약 100KB)은 원격 조작이 끊겨 보인다(실측 약 8fps).
 * 초당 30장·해상도 절반으로 줄인다. 점검 판정은 MJPEG가 아니라 takeScreenshot(원본)을 쓰므로 영향 없다.
 */
export const iosMjpegSettings = {
  mjpegServerFramerate: 30,
  mjpegScalingFactor: 50,
  mjpegServerScreenshotQuality: 35,
} as const;

/** WDA 서명 설정. 앱 설정 `ios` → 환경 변수(`IOS_TEAM_ID`·`IOS_WDA_BUNDLE_ID`) 순으로 본다 */
export interface IosSigning {
  teamId?: string;
  wdaBundleId?: string;
}
/** 기본 WDA 번들 ID(`com.facebook.WebDriverAgentRunner`)는 다른 팀과 겹쳐 서명이 실패한다. 내 팀 접두사로 바꿔 쓴다 */
export const defaultWdaBundleId = "com.example.WebDriverAgentRunner";

/** 세션 capabilities. 한 기기에 Appium 세션은 하나뿐이고 MJPEG도 이 세션의 WDA에서 나온다. 팀 id가 없으면 서명 설정을 넣지 않는다 */
export function iosCapabilities(udid: string, appId: string, signing: IosSigning = {}) {
  const teamId = signing.teamId || process.env.IOS_TEAM_ID;
  const wdaBundleId = signing.wdaBundleId || process.env.IOS_WDA_BUNDLE_ID || defaultWdaBundleId;
  return {
    platformName: "iOS",
    "appium:automationName": "XCUITest",
    "appium:udid": udid,
    "appium:bundleId": appId,
    "appium:noReset": true,
    // 기본 60초면 화면 하나가 오래 걸릴 때 세션이 끊기고 남은 화면이 모두 「세션 종료」로 실패한다.
    "appium:newCommandTimeout": iosNewCommandTimeoutSec,
    "appium:showSafariConsoleLog": true,
    "appium:showSafariNetworkLog": true,
    "appium:mjpegServerPort": iosMjpegPort,
    ...(teamId
      ? {
          "appium:xcodeOrgId": teamId,
          "appium:xcodeSigningId": "Apple Development",
          "appium:updatedWDABundleId": wdaBundleId,
          "appium:allowProvisioningDeviceRegistration": true,
        }
      : {}),
  } as const;
}

export function appiumConnection() {
  const url = new URL(process.env.APPIUM_URL || defaultAppiumUrl);
  return {
    protocol: url.protocol.replace(":", ""),
    hostname: url.hostname,
    port: Number(url.port || defaultPortOf(url.protocol)),
    path: url.pathname,
  };
}

function defaultPortOf(protocol: string): number {
  return protocol === "https:" ? 443 : 80;
}

const sessions = new Map<string, Promise<WebdriverIO.Browser>>();
const lastAliveAt = new Map<string, number>();
/** 살아 있는지 다시 묻기까지의 간격. 입력·스텝마다 Appium을 두드리지 않으려고 둔다. */
export const sessionCheckIntervalMs = 5_000;

const deadSessionPattern = /invalid session id|session is either terminated|session .* (not found|does not exist)|ECONNREFUSED|socket hang up|Could not proxy command/i;

/** Appium·WDA가 세션을 버렸을 때 나는 오류인지. 다른 오류는 세션 문제로 보지 않는다. */
export function isDeadSessionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return deadSessionPattern.test(message);
}

/**
 * 기기당 세션 하나를 열어 두고 재사용한다. 여는 중에 또 부르면 같은 Promise를 받는다.
 * 다른 프로세스가 같은 기기에 세션을 열면 이 세션은 Appium에서 사라진다(실측: MJPEG 502).
 * 그래서 재사용 전에 살아 있는지 보고, 죽었으면 새로 연다.
 */
export async function getIosSession(udid: string, appId: string, signing: IosSigning = {}): Promise<WebdriverIO.Browser> {
  const existing = sessions.get(udid);
  if (!existing) return openIosSession(udid, appId, signing);
  const session = await existing;
  if (Date.now() - (lastAliveAt.get(udid) ?? 0) < sessionCheckIntervalMs) return session;
  try {
    // getTimeouts는 Appium이 직접 답해 WDA가 죽어도 통과한다. 화면 크기는 WDA까지 간다.
    await session.getWindowSize();
    lastAliveAt.set(udid, Date.now());
    return session;
  } catch (error) {
    if (!isDeadSessionError(error)) throw error;
    if (sessions.get(udid) === existing) sessions.delete(udid);
    return openIosSession(udid, appId, signing);
  }
}

function openIosSession(udid: string, appId: string, signing: IosSigning): Promise<WebdriverIO.Browser> {
  const pending = sessions.get(udid);
  if (pending) return pending;
  const opening = remote({ ...appiumConnection(), logLevel: "warn", capabilities: iosCapabilities(udid, appId, signing) });
  sessions.set(udid, opening);
  // 열기에 실패한 세션을 남겨 두면 다음 호출도 계속 실패하므로 지운다. 실패는 호출자에게 그대로 간다.
  opening.then(
    (session) => {
      lastAliveAt.set(udid, Date.now());
      // 실패해도 화면이 느릴 뿐 점검은 된다. 다음 세션에서 다시 시도한다.
      session.updateSettings(iosMjpegSettings).catch(() => undefined);
    },
    () => {
      if (sessions.get(udid) === opening) sessions.delete(udid);
    },
  );
  return opening;
}

async function deleteQuietly(opening: Promise<WebdriverIO.Browser>): Promise<void> {
  try {
    const session = await opening;
    await session.deleteSession();
  } catch {
    // 이미 끊긴 세션(앱 재설치·기기 분리)은 닫을 것이 없다. 새 세션은 다음 getIosSession이 연다.
  }
}

/** 앱 재설치 뒤 호출. 다음 getIosSession이 새 세션을 연다. */
export async function resetIosSession(udid: string): Promise<void> {
  const opening = sessions.get(udid);
  sessions.delete(udid);
  if (opening) await deleteQuietly(opening);
}

export async function closeAllIosSessions(): Promise<void> {
  const openings = [...sessions.values()];
  sessions.clear();
  await Promise.all(openings.map(deleteQuietly));
}

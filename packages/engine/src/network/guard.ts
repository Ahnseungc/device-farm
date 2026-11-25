import type { ClickMatch, ClickRole, NetworkRecovery, ScreenDriver } from "@device-farm/core/device/driver";

/**
 * 드라이버를 감싸 앱 웹 화면의 네트워크 오류 화면을 다시 불러 고친다. 화면을 열기·누르기 전후에 본다.
 * 오류가 나서 실패한 동작은 고친 뒤 한 번 더 한다. 못 고치면 원래 오류(없으면 네트워크 오류)를 낸다.
 */
export function withNetworkRecovery(driver: ScreenDriver, log: (message: string) => void): ScreenDriver {
  const recover = driver.recoverNetwork;
  if (!recover) return driver;

  const check = async (): Promise<NetworkRecovery> => {
    const result = await recover().catch((error: unknown): NetworkRecovery => ({ status: "failed", code: error instanceof Error ? error.message : String(error) }));
    if (result.status === "recovered") log(`네트워크 오류 화면(${result.code})을 다시 불러 고쳤습니다.`);
    if (result.status === "failed") log(`네트워크 오류 화면(${result.code})이 다시 불러도 풀리지 않았습니다.`);
    return result;
  };

  /** 하기 전에 고치고, 하다 실패하면 오류 화면 때문인지 보고 고쳐서 한 번 더 */
  async function guarded(work: () => Promise<void>): Promise<void> {
    const before = await check();
    if (before.status === "failed") throw new Error(`앱 웹 화면이 네트워크 오류(${before.code})로 안 열립니다.`);
    try {
      await work();
    } catch (error) {
      const after = await check();
      if (after.status !== "recovered") throw error;
      await work();
    }
    // 화면을 연 뒤 오류 화면이 떴으면 그 자리에서 다시 불러 같은 화면이 된다
    await check();
  }

  return {
    ...driver,
    navigate: (path) => guarded(() => driver.navigate(path)),
    ...(driver.goHome ? { goHome: () => guarded(() => driver.goHome!()) } : {}),
    clickButton: (name: string, role?: ClickRole, match?: ClickMatch) => guarded(() => driver.clickButton(name, role, match)),
  };
}

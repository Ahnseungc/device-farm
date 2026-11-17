export interface SessionIntroPlayedStore {
  getStorageKey: (scopeId: string) => string;
  hasPlayed: (scopeId: string) => boolean;
  markPlayed: (scopeId: string) => void;
  shouldPlay: (scopeId: string) => boolean;
}

/** 세션당 1회 intro 재생 여부 — scopeId는 보통 userId */
export function createSessionIntroPlayed(
  keyPrefix: string,
): SessionIntroPlayedStore {
  const getStorageKey = (scopeId: string) => `${keyPrefix}${scopeId}`;

  const hasPlayed = (scopeId: string): boolean => {
    if (!scopeId) return true;

    try {
      if (typeof sessionStorage === "undefined") return true;
      return sessionStorage.getItem(getStorageKey(scopeId)) === "1";
    } catch {
      return true;
    }
  };

  const markPlayed = (scopeId: string): void => {
    if (!scopeId) return;

    try {
      if (typeof sessionStorage === "undefined") return;
      sessionStorage.setItem(getStorageKey(scopeId), "1");
    } catch {
      // sessionStorage unavailable — skip
    }
  };

  const shouldPlay = (scopeId: string): boolean => {
    if (!scopeId) return false;
    return !hasPlayed(scopeId);
  };

  return { getStorageKey, hasPlayed, markPlayed, shouldPlay };
}

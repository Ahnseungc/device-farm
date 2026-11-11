/**
 * 화면 언어(ko·en). 앱 설정의 `locale`(또는 `FARM_LOCALE`)을 App이 받자마자 `setLocale`로 한 번 정한다.
 * 데모 빌드는 처음부터 영어다(demo/api-client.ts). 문구는 쓰는 자리에서 `t("한국어", "English")`로 나란히 적는다.
 */
import { defaultFarmLocale, type FarmLocale } from "@device-farm/core/config/app-config";

let current: FarmLocale = defaultFarmLocale;

export function setLocale(locale: FarmLocale): void {
  current = locale;
  if (typeof document !== "undefined") document.documentElement.lang = locale;
}

export function getLocale(): FarmLocale {
  return current;
}

/** 지금 언어의 문구 */
export function t(ko: string, en: string): string {
  return current === "en" ? en : ko;
}

/** 날짜·시각 표기(`toLocaleString`)에 넘길 BCP 47 태그 */
export function dateLocale(): string {
  return current === "en" ? "en-US" : "ko-KR";
}

/** 영어 복수형: `plural(3, "step")` → "3 steps" */
export function plural(count: number, word: string, many = `${word}s`): string {
  return `${count} ${count === 1 ? word : many}`;
}

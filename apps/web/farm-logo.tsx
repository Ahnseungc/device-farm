import { t } from "./i18n";

/** 디바이스팜 로고. 초록 바탕에 기기(폰)와 거기서 자라는 새싹 — "실기기를 키우는 팜". */
export function FarmLogoMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" role="img" aria-label={t("디바이스팜", "Device Farm")} focusable="false">
      <defs>
        <linearGradient id="farm-logo-bg" x1="4" y1="2" x2="28" y2="30" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#C9F2D4" />
          <stop offset="1" stopColor="#34B36A" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill="url(#farm-logo-bg)" />
      <rect x="10" y="12" width="12" height="16" rx="2.5" fill="none" stroke="#0E3B22" strokeWidth="2" />
      <path d="M14 25h4" stroke="#0E3B22" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M16 12V7.5" stroke="#0E3B22" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M16 9.2C13.4 9.2 11.6 7.7 11.4 5.2C14 5.2 15.8 6.7 16 9.2Z" fill="#0E3B22" />
      <path d="M16 8C16.2 5.2 18.2 3.6 21 3.6C20.8 6.4 18.8 8 16 8Z" fill="#0E3B22" />
    </svg>
  );
}

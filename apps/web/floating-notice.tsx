import { useEffect } from "react";
import { Text } from "@seed-design/react";

import { t } from "./i18n";

/** 성공 알림이 떠 있는 시간 (작성자 판단). 실패는 닫을 때까지 둔다 */
const noticeVisibleMs = 4_000;

export interface Notice {
  text: string;
  error: boolean;
}

/**
 * 버튼을 누른 결과(시작했어요·실패) 한 줄. 화면 위에 떠서 본문을 밀어내지 않는다(레이아웃 쉬프트 방지, 2026-11-12).
 * 예전에는 본문 사이 Callout으로 끼어들어 아래 내용이 내려갔다.
 */
export function FloatingNotice({ notice, onClose }: { notice: Notice | null; onClose: () => void }) {
  useEffect(() => {
    if (!notice || notice.error) return;
    const timer = window.setTimeout(onClose, noticeVisibleMs);
    return () => window.clearTimeout(timer);
  }, [notice, onClose]);
  if (!notice) return null;
  return (
    <div className={`farm-notice${notice.error ? " farm-notice-error" : ""}`} role={notice.error ? "alert" : "status"}>
      <Text textStyle="t4Medium">{notice.text}</Text>
      <button type="button" className="farm-notice-close" aria-label={t("알림 닫기", "Close notice")} onClick={onClose}>
        ×
      </button>
    </div>
  );
}

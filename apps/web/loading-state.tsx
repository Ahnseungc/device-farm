import { Text } from "@seed-design/react";

import { t } from "./i18n";
import { ProgressCircle } from "./seed-design/ui/progress-circle";

/** 화면 전체를 처음 불러올 때. 본문 높이를 다 차지하고 가운데에 둔다(위쪽에 작게 뜨던 것, 2026-11-12) */
export function LoadingState({ label = t("불러오는 중", "Loading") }: { label?: string }) {
  return (
    <div className="farm-loading" role="status" aria-live="polite">
      <ProgressCircle aria-label={label} />
      <Text color="fg.neutralMuted">{label}</Text>
    </div>
  );
}

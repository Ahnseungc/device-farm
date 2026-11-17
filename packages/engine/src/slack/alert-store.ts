import type { DesignAlert } from "@device-farm/core/slack/design-alert";
import type { FailureAlert } from "@device-farm/core/slack/failure-alert";
import type { AlertStatusInfo, PolicyAlert } from "@device-farm/core/slack/policy-alert";

import { all, farmDb, fromJson, run as sql, type FarmDb } from "../db/farm-db";

/** 보낸 알림과 처리 상태(farm.db `slack_alerts`). 같은 어긋남은 한 번만 보내고, 버튼으로 바꾼 상태를 남긴다 */
export interface SentAlert extends AlertStatusInfo {
  /** 정책·피그마·앱 불일치, 점검 중 실패(`type: "failure"`), 피그마와 다른 문구 묶음(`type: "design"`) */
  alert: PolicyAlert | FailureAlert | DesignAlert;
  channel: string;
  ts: string;
  sentAt: string;
}

export function readAlerts(db: FarmDb = farmDb()): Record<string, SentAlert> {
  const rows = all<{ key: string; data: string }>(db, "SELECT key, data FROM slack_alerts ORDER BY rowid");
  return Object.fromEntries(rows.map((row) => [row.key, fromJson<SentAlert>(row.data, `slack_alerts(${row.key})`)]));
}

export function saveAlert(key: string, sent: SentAlert, db: FarmDb = farmDb()): void {
  sql(
    db,
    `INSERT INTO slack_alerts (key, status, path, finding, channel, ts, sent_at, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET status = excluded.status, path = excluded.path, finding = excluded.finding, channel = excluded.channel,
       ts = excluded.ts, sent_at = excluded.sent_at, data = excluded.data`,
    key,
    sent.status,
    sent.alert.path,
    sent.alert.finding,
    sent.channel,
    sent.ts,
    sent.sentAt,
    JSON.stringify(sent),
  );
}

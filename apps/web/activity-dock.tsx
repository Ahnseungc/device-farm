import { useEffect, useRef, useState } from "react";

import { Text } from "@seed-design/react";

import { botActivities, exploreActivities, finishedToast, policyActivity, runActivity, toastLeaveMs, toastVisibleMs, type Activity, type ActivityTab, type DoneToast } from "./activity-model";
import { api, usePoll } from "./api-client";
import { t } from "./i18n";
import { ProgressCircle } from "./seed-design/ui/progress-circle";
import "./activity-dock.css";

/**
 * 오른쪽 아래 「진행 중」 플로팅과 위쪽 완료 알림 카드.
 * 점검·정책 규칙 뽑기·봇 점검·탐색의 실행 상태를 폴링해, 이 화면을 연 뒤 시작된 작업이 끝나면 알린다.
 */
interface ActivityDockProps {
  /** 누른 작업. 점검(`run:`)은 진행 패널을 다시 연다 */
  onOpen: (activity: Pick<Activity, "id" | "tab">) => void;
  /** 플로우 만들기처럼 오른쪽을 다 쓰는 화면에서는 플로팅을 숨긴다. 완료 알림은 그대로 띄운다 */
  hideDock?: boolean;
  /** 오른쪽 점검 진행 패널이 떠 있으면 기기 점검 줄만 뺀다(같은 내용이 겹친다). 다른 점검은 그대로 */
  hideRun?: boolean;
}

export function ActivityDock({ onOpen, hideDock = false, hideRun = false }: ActivityDockProps) {
  const run = usePoll(api.latestRun);
  const policy = usePoll(api.policy);
  const bots = usePoll(api.chaosRuns);
  const explores = usePoll(api.latestExplore);
  const [toasts, setToasts] = useState<(DoneToast & { leaving?: boolean })[]>([]);
  const seen = useRef(new Set<string>());
  /** 「중지」를 누른 작업. 끝나 목록에서 빠질 때까지 「중지하는 중」 */
  const [stopping, setStopping] = useState<Set<string>>(new Set());
  const [stopErrors, setStopErrors] = useState<Record<string, string>>({});
  const nextKey = useRef(0);

  const active = [runActivity(run.data), policyActivity(policy.data), ...botActivities(bots.data), ...exploreActivities(explores.data)].filter(
    (item): item is Activity => item !== null,
  );
  const activeIds = active.map((item) => item.id).join("|");
  const shown = active.filter((item) => !(hideRun && item.stop === "run"));

  const handleStop = async (item: Activity) => {
    setStopping((current) => new Set(current).add(item.id));
    setStopErrors((current) => Object.fromEntries(Object.entries(current).filter(([id]) => id !== item.id)));
    try {
      await api.stopJob(item.stop);
    } catch (error) {
      setStopping((current) => {
        const next = new Set(current);
        next.delete(item.id);
        return next;
      });
      setStopErrors((current) => ({ ...current, [item.id]: error instanceof Error ? error.message : t("중지하지 못했어요.", "Could not stop it.") }));
    }
  };

  useEffect(() => {
    const now = new Set(activeIds ? activeIds.split("|") : []);
    const finished = [...seen.current].filter((id) => !now.has(id));
    seen.current = now;
    // 끝난 작업의 「중지하는 중」·오류는 지운다
    setStopping((current) => new Set([...current].filter((id) => now.has(id))));
    setStopErrors((current) => Object.fromEntries(Object.entries(current).filter(([id]) => now.has(id))));
    if (finished.length === 0) return;
    const sources = { run: run.data, policy: policy.data, bots: bots.data, explores: explores.data };
    const created = finished.map((id) => ({ ...finishedToast(id, sources), key: (nextKey.current += 1) }));
    setToasts((current) => [...current, ...created]);
    for (const toast of created) {
      window.setTimeout(() => setToasts((current) => current.map((item) => (item.key === toast.key ? { ...item, leaving: true } : item))), toastVisibleMs);
      window.setTimeout(() => setToasts((current) => current.filter((item) => item.key !== toast.key)), toastVisibleMs + toastLeaveMs);
    }
    // 폴링 값은 activeIds가 바뀔 때의 것을 쓴다(끝난 순간의 결과)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIds]);

  return (
    <>
      <div className="activity-toasts" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <button
            key={toast.key}
            type="button"
            className={`activity-toast activity-toast-${toast.tone}${toast.leaving ? " is-leaving" : ""}`}
            onClick={() => onOpen({ id: `toast:${toast.key}`, tab: toast.tab })}
          >
            <Text textStyle="t4Bold">{toast.title}</Text>
            <Text textStyle="t3Regular" color="fg.neutralSubtle">{toast.detail}</Text>
          </button>
        ))}
      </div>
      {shown.length > 0 && !hideDock ? (
        <section className="activity-dock" aria-label={t("진행 중인 작업", "Running jobs")}>
          <Text textStyle="t3Bold" color="fg.neutralMuted">{t(`진행 중 ${shown.length}개`, `${shown.length} running`)}</Text>
          {shown.map((item) => {
            const isStopping = stopping.has(item.id);
            return (
              <div key={item.id} className="activity-item">
                <button type="button" className="activity-item-open" onClick={() => onOpen(item)}>
                  <ProgressCircle size="24" aria-hidden="true" />
                  <span className="activity-item-body">
                    <Text textStyle="t4Medium">{item.title}</Text>
                    <Text textStyle="t3Regular" color="fg.neutralSubtle" className="activity-item-detail">
                      {isStopping ? t("지금 하던 것만 마치고 멈춰요", "Stopping after the current step") : item.detail}
                    </Text>
                    {item.ratio !== undefined ? (
                      <span className="activity-bar" aria-hidden="true">
                        <span className="activity-bar-fill" style={{ transform: `scaleX(${item.ratio})` }} />
                      </span>
                    ) : null}
                    {stopErrors[item.id] ? (
                      <Text textStyle="t3Regular" color="fg.critical">{stopErrors[item.id]}</Text>
                    ) : null}
                  </span>
                </button>
                <button type="button" className="activity-stop" disabled={isStopping} aria-label={t(`${item.title} 중지`, `Stop ${item.title}`)} onClick={() => void handleStop(item)}>
                  {isStopping ? t("중지하는 중", "Stopping") : t("중지", "Stop")}
                </button>
              </div>
            );
          })}
        </section>
      ) : null}
    </>
  );
}

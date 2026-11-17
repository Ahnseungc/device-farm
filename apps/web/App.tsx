import { useEffect, useState } from "react";

import type { PublicAppConfig } from "@device-farm/core/config/app-config";
import type { IssueKind } from "@device-farm/core/issues/issue";

import { ActivityDock } from "./activity-dock";
import { api, errorMessage, usePoll } from "./api-client";
import { AppConfigProvider } from "./app-context";
import { BaselinesScreen } from "./baselines-screen";
import { ChaosScreen } from "./chaos-screen";
import { DesignScreen } from "./design-screen";
import { DeviceDetail } from "./device-detail";
import { DevicesScreen } from "./devices-screen";
import { ExploreScreen } from "./explore-screen";
import { FarmLogoMark } from "./farm-logo";
import { FlowsScreen } from "./flows-screen";
import { setLocale, t } from "./i18n";
import { IssuesScreen } from "./issues-screen";
import { LoadingState } from "./loading-state";
import { PolicyScreen } from "./policy-screen";
import { ResultsScreen } from "./results-screen";
import { RunProgressPanel } from "./run-progress-panel";
import { TodayDialog } from "./today-screen";

/** 매일 보는 화면 */
const mainTabIds = ["issues", "results"] as const;

/** 가끔 손보는 화면(설정·관리) */
const manageTabIds = ["devices", "flows", "design", "chaos", "policy", "baselines", "explore"] as const;

type TabId = (typeof mainTabIds)[number] | (typeof manageTabIds)[number];

const tabLabel = (id: TabId): string =>
  ({
    issues: t("문제", "Problems"),
    results: t("점검 기록", "Run history"),
    devices: t("기기·점검 실행", "Devices & runs"),
    flows: t("플로우", "Flows"),
    design: t("디자인 점검", "Design check"),
    chaos: t("봇 점검", "Bot check"),
    policy: t("정책 규칙", "Policy rules"),
    baselines: t("기준 화면", "Baselines"),
    explore: t("탐색", "Explore"),
  })[id];

/** 오늘 요약을 그날 처음 들어왔을 때 한 번 띄운다(브라우저마다). 저장이 막혀 있으면 매번 띄운다 */
const todaySeenKey = "device-farm.todaySeen";
const todayKey = () => new Date().toLocaleDateString("sv-SE");

function seenToday(): boolean {
  try {
    return window.localStorage.getItem(todaySeenKey) === todayKey();
  } catch {
    return false;
  }
}

function markSeenToday(): void {
  try {
    window.localStorage.setItem(todaySeenKey, todayKey());
  } catch {
    // 저장이 막힌 브라우저(사생활 보호 모드)는 다음에 또 띄운다
  }
}

/** 앱 설정을 한 번 받은 뒤 화면을 그린다. 못 받으면 이유를 보여 준다 */
export function App() {
  const [app, setApp] = useState<PublicAppConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.app().then(
      (loaded) => {
        setLocale(loaded.locale ?? "ko");
        setApp(loaded);
      },
      (reason: unknown) => setError(errorMessage(reason)),
    );
  }, []);
  if (error) return <p className="farm-error">{t("앱 설정을 읽지 못했습니다", "Could not read the app config")}: {error}</p>;
  if (!app) return <LoadingState />;
  return (
    <AppConfigProvider value={app}>
      <FarmShell appName={app.name} />
    </AppConfigProvider>
  );
}

function FarmShell({ appName }: { appName: string }) {
  const [tab, setTab] = useState<TabId>("issues");
  const [todayOpen, setTodayOpen] = useState(() => !seenToday());
  const closeToday = () => {
    markSeenToday();
    setTodayOpen(false);
  };
  /** 「오늘」에서 유형을 눌러 들어오면 그 유형만 보여 준다 */
  const [issueKind, setIssueKind] = useState<{ kind: IssueKind | null; at: number }>({ kind: null, at: 0 });
  const open = (next: TabId) => {
    setTab(next);
    setOpenDeviceId(null);
  };
  const [openDeviceId, setOpenDeviceId] = useState<string | null>(null);
  const [progressShown, setProgressShown] = useState(false);
  const [creatingFlow, setCreatingFlow] = useState(false);
  const [progressReopen, setProgressReopen] = useState(0);
  useEffect(() => {
    document.title = `${t("디바이스팜", "Device Farm")} · ${appName}`;
  }, [appName]);

  return (
    <div className="farm-app">
      <aside className="farm-sidebar">
        <div className="farm-sidebar-logo">
          <FarmLogoMark />
        </div>
        <nav aria-label={t("화면", "Screens")} className="farm-nav">
          {mainTabIds.map((id) => (
            <NavItem key={id} label={tabLabel(id)} current={tab === id} onClick={() => open(id)} />
          ))}
          <p className="farm-nav-group">{t("관리", "Manage")}</p>
          {manageTabIds.map((id) => (
            <NavItem key={id} label={tabLabel(id)} current={tab === id} onClick={() => open(id)} />
          ))}
        </nav>
        <button type="button" className="farm-today-button" onClick={() => setTodayOpen(true)}>
          {t("오늘 요약 보기", "Today's summary")}
        </button>
      </aside>
      <main className="farm-main">
        {tab === "issues" ? <IssuesScreen key={issueKind.at} initialKind={issueKind.kind} /> : null}
        {tab === "devices" && openDeviceId ? (
          <OpenDevice deviceId={openDeviceId} onClose={() => setOpenDeviceId(null)} />
        ) : null}
        {tab === "devices" && !openDeviceId ? <DevicesScreen onOpen={setOpenDeviceId} /> : null}
        {tab === "results" ? <ResultsScreen onOpenBot={() => open("chaos")} /> : null}
        {tab === "baselines" ? <BaselinesScreen /> : null}
        {tab === "flows" ? <FlowsScreen onCreatingChange={setCreatingFlow} /> : null}
        {tab === "explore" ? <ExploreScreen /> : null}
        {tab === "chaos" ? <ChaosScreen /> : null}
        {tab === "design" ? <DesignScreen /> : null}
        {tab === "policy" ? <PolicyScreen /> : null}
      </main>
      <TodayDialog
        open={todayOpen}
        onClose={closeToday}
        onOpenIssues={(kind) => {
          setIssueKind({ kind, at: Date.now() });
          open("issues");
          closeToday();
        }}
        onOpenRuns={() => {
          open("results");
          closeToday();
        }}
        onOpenDevices={() => {
          open("devices");
          closeToday();
        }}
      />
      <ActivityDock
        hideDock={tab === "flows" && creatingFlow}
        hideRun={progressShown}
        onOpen={(activity) => {
          if (activity.id.startsWith("run:")) {
            setProgressReopen((count) => count + 1);
            return;
          }
          open(activity.tab);
        }}
      />
      <RunProgressPanel
        onShownChange={setProgressShown}
        reopenSignal={progressReopen}
        onOpenResults={() => open("results")}
      />
    </div>
  );
}

function NavItem({ label, current, onClick }: { label: string; current: boolean; onClick: () => void }) {
  return (
    <button type="button" className="farm-nav-item" aria-current={current ? "page" : undefined} onClick={onClick}>
      {label}
    </button>
  );
}

/** 상세에서도 상태 칩이 살아 있도록 기기 목록을 계속 받는다. */
function OpenDevice({ deviceId, onClose }: { deviceId: string; onClose: () => void }) {
  const devices = usePoll(api.devices);
  const device = devices.data?.find((item) => item.id === deviceId);
  if (devices.error && !device) return <p className="farm-error">{devices.error}</p>;
  if (!devices.data) return <LoadingState />;
  if (!device) return <p className="farm-error">{t("기기를 찾지 못했습니다.", "Device not found.")} ({deviceId})</p>;
  return <DeviceDetail device={device} onClose={onClose} />;
}

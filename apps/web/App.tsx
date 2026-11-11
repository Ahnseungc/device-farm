import { useEffect, useState } from "react";

import type { PublicAppConfig } from "@device-farm/core/config/app-config";

import { api, errorMessage, usePoll } from "./api-client";
import { AppConfigProvider } from "./app-context";
import { BaselinesScreen } from "./baselines-screen";
import { ChaosScreen } from "./chaos-screen";
import { DeviceDetail } from "./device-detail";
import { DevicesScreen } from "./devices-screen";
import { ExploreScreen } from "./explore-screen";
import { FarmLogoMark } from "./farm-logo";
import { FlowsScreen } from "./flows-screen";
import { PolicyScreen } from "./policy-screen";
import { ResultsScreen } from "./results-screen";
import { RunProgressPanel } from "./run-progress-panel";

const tabs = [
  { id: "devices", label: "기기" },
  { id: "results", label: "결과" },
  { id: "baselines", label: "기준 화면" },
  { id: "flows", label: "플로우" },
  { id: "explore", label: "탐색" },
  { id: "chaos", label: "카오스" },
  { id: "policy", label: "정책" },
] as const;

type TabId = (typeof tabs)[number]["id"];

/** 앱 설정을 한 번 받은 뒤 화면을 그린다. 못 받으면 이유를 보여 준다 */
export function App() {
  const [app, setApp] = useState<PublicAppConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.app().then(setApp, (reason: unknown) => setError(errorMessage(reason)));
  }, []);
  if (error) return <p className="farm-error">앱 설정을 읽지 못했습니다: {error}</p>;
  if (!app) return <p className="farm-note">불러오는 중</p>;
  return (
    <AppConfigProvider value={app}>
      <FarmShell appName={app.name} />
    </AppConfigProvider>
  );
}

function FarmShell({ appName }: { appName: string }) {
  const [tab, setTab] = useState<TabId>("devices");
  const [openDeviceId, setOpenDeviceId] = useState<string | null>(null);
  useEffect(() => {
    document.title = `디바이스팜 · ${appName}`;
  }, [appName]);

  return (
    <div className="farm-app">
      <aside className="farm-sidebar">
        <div className="farm-sidebar-logo">
          <FarmLogoMark />
        </div>
        <nav aria-label="화면" className="farm-nav">
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              className="farm-nav-item"
              aria-current={tab === item.id ? "page" : undefined}
              onClick={() => {
                setTab(item.id);
                setOpenDeviceId(null);
              }}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </aside>
      <main className="farm-main">
        {tab === "devices" && openDeviceId ? (
          <OpenDevice deviceId={openDeviceId} onClose={() => setOpenDeviceId(null)} />
        ) : null}
        {tab === "devices" && !openDeviceId ? <DevicesScreen onOpen={setOpenDeviceId} /> : null}
        {tab === "results" ? <ResultsScreen /> : null}
        {tab === "baselines" ? <BaselinesScreen /> : null}
        {tab === "flows" ? <FlowsScreen /> : null}
        {tab === "explore" ? <ExploreScreen /> : null}
        {tab === "chaos" ? <ChaosScreen /> : null}
        {tab === "policy" ? <PolicyScreen /> : null}
      </main>
      <RunProgressPanel
        onOpenResults={() => {
          setTab("results");
          setOpenDeviceId(null);
        }}
      />
    </div>
  );
}

/** 상세에서도 상태 칩이 살아 있도록 기기 목록을 계속 받는다. */
function OpenDevice({ deviceId, onClose }: { deviceId: string; onClose: () => void }) {
  const devices = usePoll(api.devices);
  const device = devices.data?.find((item) => item.id === deviceId);
  if (devices.error && !device) return <p className="farm-error">{devices.error}</p>;
  if (!devices.data) return <p className="farm-note">불러오는 중</p>;
  if (!device) return <p className="farm-error">기기를 찾지 못했습니다. ({deviceId})</p>;
  return <DeviceDetail device={device} onClose={onClose} />;
}

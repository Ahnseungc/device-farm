import type { InstallConfig } from "@device-farm/core/config/app-config";

import { defaultBuildDeps, firebaseAppId, listReleases, pickRelease, type FetchJson } from "./build/firebase";
import { ascAppId, ascFetchJson, listTestflightBuilds } from "./build/testflight";
import { createReleaseWatcher, releasePollMs, releaseSignals, testflightSignals, type Signal, type WatchTarget } from "./build/watch";

export interface AutoWatchDeps {
  isBusy: () => boolean;
  /** 그 플랫폼의 연결된 기기로 trigger "auto" 점검. 바쁘면 끝날 때까지 기다렸다 돈다. */
  runAuto: (signal: Signal) => Promise<void>;
  failIos: (signal: Signal, message: string) => Promise<void>;
  log: (message: string) => void;
  fetchJson?: FetchJson;
  /** Firebase 앱 id(환경 변수가 비었을 때) */
  install?: Pick<InstallConfig, "firebase">;
}

/**
 * iOS는 dev·운영 모두 TestFlight, Android는 Firebase 릴리스. 최신 순.
 * iOS dev는 TestFlight로 깔 수 있다(앱 설정 install.sources). iOS 운영은 같은 버전 Firebase Ad-hoc을 기다린다.
 */
function signalLister(fetchJson: FetchJson, install: AutoWatchDeps["install"]) {
  const ascFetch = ascFetchJson();
  return async (target: WatchTarget): Promise<Signal[]> => {
    if (target.platform === "ios") return testflightSignals(target, await listTestflightBuilds(ascFetch, ascAppId(target.kind)));
    return releaseSignals(target, await listReleases(firebaseAppId(target.platform, target.kind, install), fetchJson));
  };
}

/** 같은 version+build의 Firebase 운영 iOS Ad-hoc이 있는지. */
function adhocFinder(fetchJson: FetchJson, install: AutoWatchDeps["install"]) {
  return async (signal: Signal): Promise<boolean> => {
    const releases = await listReleases(firebaseAppId("ios", "prod", install), fetchJson);
    return pickRelease(releases, signal.version) !== null;
  };
}

/**
 * 새 빌드 자동 점검. 지금 한 번, 이후 releasePollMs마다. 점검이 끝나면 호출부가 tick()을 불러 대기열을 바로 꺼낸다.
 */
export function startAutoWatch(deps: AutoWatchDeps) {
  const fetchJson = deps.fetchJson ?? defaultBuildDeps(deps.install).fetchJson;
  const watcher = createReleaseWatcher({
    listSignals: signalLister(fetchJson, deps.install),
    isBusy: deps.isBusy,
    startRun: deps.runAuto,
    findAdhoc: adhocFinder(fetchJson, deps.install),
    failIos: deps.failIos,
    log: deps.log,
  });
  void watcher.tick();
  const timer = setInterval(() => void watcher.tick(), releasePollMs);
  timer.unref();
  return { tick: () => watcher.tick(), stop: () => clearInterval(timer) };
}

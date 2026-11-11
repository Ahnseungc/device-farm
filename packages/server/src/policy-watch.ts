import type { AppConfig, FigmaConfig } from "@device-farm/core/config/app-config";
import { nextScheduledAt, isPolicyCheckDue } from "@device-farm/core/policy/schedule";
import type { PolicyRulesSummary, PolicyWatchState } from "@device-farm/core/policy/snapshot";
import { askClaude, type AskClaude } from "@device-farm/engine/policy/claude";
import { confluenceConfigFromEnv, fetchPolicySnapshot, type FetchLike } from "@device-farm/engine/policy/confluence";
import { refreshRules } from "@device-farm/engine/policy/extract";
import { fetchFigmaTexts } from "@device-farm/engine/policy/figma";
import { buildFrontFigma, readFrontFigmaMap } from "@device-farm/engine/policy/front-figma";
import { readAllPageRules, readFigmaCache, writeFigmaCache } from "@device-farm/engine/policy/rules-store";
import { readChanges, readSnapshot, readSources, recordSnapshot } from "@device-farm/engine/policy/store";

/** 일정 시각이 지났는지 보는 간격 (작성자 판단) */
export const policyPollMs = 60 * 60_000;
/** 화면에 보여 줄 바뀜 기록 수 */
const recentChanges = 50;

export interface PolicyWatchDeps {
  app: AppConfig;
  log: (message: string) => void;
  /** Claude가 고를 화면 경로 목록(화면 지도·시나리오). 뽑을 때마다 다시 읽는다 */
  knownScreens: () => string[];
  fetchImpl?: FetchLike;
  ask?: AskClaude;
  now?: () => Date;
}

export interface PolicyWatch {
  state: () => PolicyWatchState;
  /** 지금 확인. 이미 도는 중이면 false */
  checkNow: () => boolean;
  stop: () => void;
}

/** 페이지별 뽑기 요약. 화면에는 규칙 본문 대신 수만 보낸다 */
function rulesSummary(): PolicyRulesSummary[] {
  return readAllPageRules().map((page) => ({
    pageId: page.pageId,
    pageTitle: page.pageTitle,
    extractedAt: page.extractedAt,
    screens: page.screens,
    figma: page.figma.length,
    rules: page.rules,
    dropped: page.dropped,
  }));
}

/** 프론트 코드(앱 설정 `figma.frontRepo`, 없으면 FLOW_PRD_ROOT)에서 화면 → 피그마 노드를 다시 만든다. 체크아웃이 없으면 건너뛴다 */
export function refreshFrontFigma(figma: FigmaConfig, log: (message: string) => void): void {
  const frontRoot = figma.frontRepo?.trim() || process.env.FLOW_PRD_ROOT?.trim();
  if (!frontRoot) return;
  try {
    const map = buildFrontFigma(frontRoot, process.env.FARM_FRONT_REF?.trim() || figma.ref, undefined, undefined, figma.appDir);
    log(`프론트 ${map.ref}@${map.commit} 화면 ${Object.keys(map.routes).length}개에 피그마 노드 연결`);
  } catch (error) {
    log(`프론트 피그마 연결 실패: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** 정책 본문·프론트 코드에 연결된 피그마 노드 문구를 새로 읽는다. 토큰이 없으면 건너뛴다 */
export async function refreshFigma(fetchImpl: FetchLike, log: (message: string) => void): Promise<void> {
  const token = process.env.FIGMA_TOKEN?.trim();
  const front = Object.values(readFrontFigmaMap()?.routes ?? {}).flat();
  const refs = [...new Set([...readAllPageRules().flatMap((page) => page.figma), ...front])];
  if (!token || refs.length === 0) return;
  const texts = await fetchFigmaTexts(token, refs, fetchImpl);
  writeFigmaCache({ ...readFigmaCache(), ...texts });
  log(`피그마 노드 ${Object.keys(texts).length}개 문구 읽음`);
}

/**
 * 정책 바뀜 감지 → 바뀐 페이지 규칙 다시 뽑기 → 피그마 문구 읽기를 매일 한 번 돌린다(docs/design-policy-figma.md).
 * 한 시간마다 예정 시각이 지났는지 보고, 서버가 그 시각에 꺼져 있었어도 켜지면 바로 돈다. Confluence 토큰이 없으면 아무것도 하지 않는다.
 */
export function startPolicyWatch(deps: PolicyWatchDeps): PolicyWatch {
  const now = deps.now ?? (() => new Date());
  const fetchImpl: FetchLike = deps.fetchImpl ?? ((url, init) => fetch(url, init));
  const ask = deps.ask ?? askClaude;
  let running = false;
  let lastError: string | null = null;
  let failed: PolicyWatchState["failed"] = [];
  let extractFailed: PolicyWatchState["extractFailed"] = [];
  let progress: PolicyWatchState["progress"] = null;

  const run = async () => {
    const config = confluenceConfigFromEnv(deps.app.policy.confluence);
    if (!config || running) return;
    running = true;
    try {
      const result = await fetchPolicySnapshot(config, readSources().pages.map((page) => page.pageId), fetchImpl, now);
      const changes = recordSnapshot(result.snapshot);
      failed = result.failed;
      lastError = null;
      deps.log(`정책 ${Object.keys(result.snapshot.pages).length}개 확인 · 바뀜 ${changes.length}개${failed.length ? ` · 읽기 실패 ${failed.length}개` : ""}`);
      const refreshed = await refreshRules(result.snapshot, {
        config,
        ask,
        fetchImpl,
        knownScreens: deps.knownScreens(),
        appName: deps.app.name,
        log: deps.log,
        now,
        onProgress: (done, total) => (progress = { done, total }),
      });
      extractFailed = refreshed.failed;
      refreshFrontFigma(deps.app.figma, deps.log);
      await refreshFigma(fetchImpl, deps.log);
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      deps.log(`정책 확인 실패: ${lastError}`);
    } finally {
      running = false;
      progress = null;
    }
  };

  const tick = () => {
    if (isPolicyCheckDue(readSnapshot().checkedAt || null, now())) void run();
  };
  tick();
  const timer = setInterval(tick, policyPollMs);
  timer.unref();

  return {
    state: () => {
      const snapshot = readSnapshot();
      return {
        configured: confluenceConfigFromEnv(deps.app.policy.confluence) !== null,
        figmaConfigured: Boolean(process.env.FIGMA_TOKEN?.trim()),
        running,
        progress,
        checkedAt: snapshot.checkedAt || null,
        nextAt: nextScheduledAt(now()).toISOString(),
        lastError,
        failed,
        extractFailed,
        pages: Object.values(snapshot.pages).sort((a, b) => (a.modifiedAt < b.modifiedAt ? 1 : -1)),
        changes: readChanges(recentChanges),
        rules: rulesSummary(),
      };
    },
    checkNow: () => {
      if (running) return false;
      void run();
      return true;
    },
    stop: () => clearInterval(timer),
  };
}

import { useEffect, useState } from "react";
import { HStack, Text, VStack } from "@seed-design/react";

import type { LogEntry } from "@device-farm/core/device/types";
import type { QaCheck } from "@device-farm/core/qa/rules";

import { errorMessage, fetchLogs, joinPath, resultFileUrl } from "./api-client";
import { dateLocale, plural, t } from "./i18n";
import type { FailedCell } from "./results-screen";
import { Badge } from "./seed-design/ui/badge";
import { Callout } from "./seed-design/ui/callout";
import { DialogAction, DialogBody, DialogContent, DialogFooter, DialogRoot } from "./seed-design/ui/dialog";
import { ProgressCircle } from "./seed-design/ui/progress-circle";

/** 실패 묶음 파일 이름. packages/engine/src/results.ts `writeFailureBundle`과 같다. */
const bundleFiles = {
  screenshot: "screenshot.png",
  baseline: "baseline.png",
  diff: "diff.png",
  video: "video.mp4",
} as const;

interface FailureDetailProps {
  cell: FailedCell;
  onClose: () => void;
}

export function FailureDetail({ cell, onClose }: FailureDetailProps) {
  const { outcome, screen } = cell;
  const logDir = screen.logDir;
  const [logs, setLogs] = useState<LogEntry[] | null>(null);
  const [logError, setLogError] = useState<string | null>(null);

  useEffect(() => {
    if (!logDir) return;
    let cancelled = false;
    fetchLogs(logDir)
      .then((entries) => !cancelled && setLogs(entries))
      .catch((error: unknown) => !cancelled && setLogError(errorMessage(error)));
    return () => {
      cancelled = true;
    };
  }, [logDir]);

  const screenshot = screen.screenshot ?? (logDir ? joinPath(logDir, bundleFiles.screenshot) : null);
  const file = (name: string) => (logDir ? resultFileUrl(joinPath(logDir, name)) : null);

  return (
    <DialogRoot open size="large" onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title={`${screen.scenario} · ${outcome.device.model} ${outcome.device.osVersion}`}
        description={t("실패 상세", "Failure details")}
      >
        <DialogBody>
          <VStack gap="x5" align="stretch" width="full">
            {screen.message ? <Callout tone="critical" description={screen.message} /> : null}
            {screen.checks ? <QaCheckList checks={screen.checks} /> : null}

            <div className="failure-images">
              <Figure title={t("기준", "Baseline")} src={file(bundleFiles.baseline)} />
              <Figure title={t("이번", "This run")} src={screenshot ? resultFileUrl(screenshot) : null} />
              <Figure title={t("차이", "Diff")} src={file(bundleFiles.diff)} />
            </div>

            <VStack gap="x2" align="stretch">
              <Text as="h3" textStyle="t4Bold">
                {t("영상", "Video")}
              </Text>
              {logDir ? (
                <video className="failure-video" src={file(bundleFiles.video) ?? undefined} controls>
                  {t("영상이 없습니다.", "No video.")}
                </video>
              ) : (
                <Text color="fg.neutralMuted">{t("영상이 없습니다.", "No video.")}</Text>
              )}
            </VStack>

            <VStack gap="x2" align="stretch">
              <Text as="h3" textStyle="t4Bold">
                {t("로그", "Logs")}
              </Text>
              <LogList logs={logs} error={logError} hasDir={Boolean(logDir)} />
            </VStack>
          </VStack>
        </DialogBody>
        <DialogFooter>
          <HStack gap="x2" justify="flex-end" width="full">
            <DialogAction variant="neutralWeak">{t("닫기", "Close")}</DialogAction>
          </HStack>
        </DialogFooter>
      </DialogContent>
    </DialogRoot>
  );
}

/** 데이터 QA 규칙별 결과. 실패를 위로 올린다. */
function QaCheckList({ checks }: { checks: QaCheck[] }) {
  const sorted = [...checks].sort((a, b) => Number(a.ok) - Number(b.ok));
  return (
    <VStack gap="x2" align="stretch">
      <Text as="h3" textStyle="t4Bold">
        {t(`규칙 ${checks.length}개 · 실패 ${checks.filter((check) => !check.ok).length}개`, `${plural(checks.length, "rule")} · ${checks.filter((check) => !check.ok).length} failed`)}
      </Text>
      <ul className="failure-checks">
        {sorted.map((check) => (
          <li key={check.id}>
            <Badge tone={check.ok ? "positive" : "critical"} variant="weak">
              {check.ok ? t("통과", "Passed") : t("실패", "Failed")}
            </Badge>
            <VStack gap="x0_5">
              <Text textStyle="t4Medium">{check.title}</Text>
              {check.message ? <Text textStyle="t3Regular" color="fg.critical">{check.message}</Text> : null}
            </VStack>
          </li>
        ))}
      </ul>
    </VStack>
  );
}

function Figure({ title, src }: { title: string; src: string | null }) {
  // 화면 비교가 아닌 실패(앱 오류 등)는 기준·차이 파일이 없다.
  const [missing, setMissing] = useState(false);
  return (
    <figure className="failure-figure">
      <figcaption>
        <Text textStyle="t3Bold" color="fg.neutralMuted">
          {title}
        </Text>
      </figcaption>
      {src && !missing ? (
        <img src={src} alt={t(`${title} 화면`, `${title} screen`)} className="failure-shot" onError={() => setMissing(true)} />
      ) : (
        <div className="failure-shot failure-shot-empty">
          <Text textStyle="t3Regular" color="fg.neutralSubtle">
            {t("없음", "None")}
          </Text>
        </div>
      )}
    </figure>
  );
}

function LogList({ logs, error, hasDir }: { logs: LogEntry[] | null; error: string | null; hasDir: boolean }) {
  if (!hasDir) return <Text color="fg.neutralMuted">{t("로그가 없습니다.", "No logs.")}</Text>;
  if (error) return <Callout tone="critical" description={error} />;
  if (!logs) {
    return (
      <HStack gap="x2" align="center">
        <ProgressCircle aria-label={t("불러오는 중", "Loading")} />
        <Text color="fg.neutralMuted">{t("불러오는 중", "Loading")}</Text>
      </HStack>
    );
  }
  if (logs.length === 0) return <Text color="fg.neutralMuted">{t("로그가 없습니다.", "No logs.")}</Text>;
  return (
    <ol className="failure-logs">
      {logs.map((entry, index) => (
        <li key={`${entry.at}-${index}`} data-source={entry.source}>
          <span className="failure-log-meta">
            {new Date(entry.at).toLocaleTimeString(dateLocale())} {entry.source}
          </span>{" "}
          {entry.text}
        </li>
      ))}
    </ol>
  );
}

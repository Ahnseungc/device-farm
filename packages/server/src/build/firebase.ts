import { createWriteStream } from "node:fs";
import { access, mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";

import { GoogleAuth } from "google-auth-library";

import type { InstallConfig } from "@device-farm/core/config/app-config";
import type { BuildKind, Platform } from "@device-farm/core/device/types";

export interface Release {
  name: string;
  displayVersion: string;
  buildVersion: string;
  createTime: string;
  binaryDownloadUri: string;
}

export type FetchJson = (url: string) => Promise<unknown>;

export interface BuildDeps {
  fetchJson: FetchJson;
  download: (url: string, dest: string) => Promise<void>;
  root?: string;
  /** Firebase 앱 id를 환경 변수에서 못 찾으면 보는 앱 설정 */
  install?: Pick<InstallConfig, "firebase">;
}

export interface BuildInput {
  platform: Platform;
  kind: BuildKind;
  version: string;
}

export const buildCacheDir = "test-results/builds";
const releasesBaseUrl = "https://firebaseappdistribution.googleapis.com/v1";
const cloudPlatformScope = "https://www.googleapis.com/auth/cloud-platform";

const binaryExtensions = { android: "apk", ios: "ipa" } as const satisfies Record<Platform, string>;

function appIdEnvName(platform: Platform, kind: BuildKind): string {
  return `FIREBASE_APP_${platform.toUpperCase()}_${kind.toUpperCase()}`;
}

/** Firebase App Distribution 앱 id. 환경 변수 → 앱 설정 `install.firebase` 순 */
export function firebaseAppId(platform: Platform, kind: BuildKind, install?: Pick<InstallConfig, "firebase">): string {
  const envName = appIdEnvName(platform, kind);
  const value = (process.env[envName]?.trim() || install?.firebase?.[platform]?.[kind] || "").trim();
  if (!value) throw new Error(`${envName}이 비어 있습니다.`);
  return value;
}

function projectNumber(appId: string): string {
  const number = appId.split(":")[1];
  if (!number) throw new Error(`Firebase 앱 ID 형식이 아닙니다: ${appId}`);
  return number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toRelease(value: unknown): Release {
  const fields = ["name", "displayVersion", "buildVersion", "createTime", "binaryDownloadUri"] as const;
  if (!isRecord(value) || fields.some((field) => typeof value[field] !== "string")) {
    throw new Error("Firebase 릴리스 응답 형식이 다릅니다.");
  }
  const [name, displayVersion, buildVersion, createTime, binaryDownloadUri] = fields.map((field) => String(value[field]));
  return { name, displayVersion, buildVersion, createTime, binaryDownloadUri };
}

function parsePage(body: unknown): { releases: Release[]; nextPageToken: string | null } {
  if (!isRecord(body)) throw new Error("Firebase 릴리스 목록 응답 형식이 다릅니다.");
  const raw = body.releases ?? [];
  if (!Array.isArray(raw)) throw new Error("Firebase 릴리스 목록 응답 형식이 다릅니다.");
  const token = typeof body.nextPageToken === "string" && body.nextPageToken ? body.nextPageToken : null;
  return { releases: raw.map(toRelease), nextPageToken: token };
}

export async function listReleases(appId: string, fetchJson: FetchJson): Promise<Release[]> {
  const baseUrl = `${releasesBaseUrl}/projects/${projectNumber(appId)}/apps/${appId}/releases`;
  const releases: Release[] = [];
  let pageToken: string | null = null;
  do {
    const url: string = pageToken ? `${baseUrl}?pageToken=${encodeURIComponent(pageToken)}` : baseUrl;
    const page = parsePage(await fetchJson(url));
    releases.push(...page.releases);
    pageToken = page.nextPageToken;
  } while (pageToken);
  return releases;
}

/** `2.1.5`는 표시 버전 중 최신, `2.1.5+412`는 빌드 번호까지 맞춘다. */
export function pickRelease(releases: readonly Release[], version: string): Release | null {
  const [displayVersion, buildVersion] = version.split("+");
  const matches = releases.filter(
    (release) => release.displayVersion === displayVersion && (!buildVersion || release.buildVersion === buildVersion),
  );
  const byNewest = (a: Release, b: Release) => Date.parse(b.createTime) - Date.parse(a.createTime);
  return [...matches].sort(byNewest)[0] ?? null;
}

function cachePath(input: BuildInput, release: Release, root: string): string {
  const fileName = `${input.platform}-${input.kind}-${release.displayVersion}-${release.buildVersion}.${binaryExtensions[input.platform]}`;
  return path.join(root, buildCacheDir, fileName);
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function downloadAtomically(url: string, dest: string, deps: BuildDeps): Promise<void> {
  const partPath = `${dest}.part`;
  try {
    await deps.download(url, partPath);
    await rename(partPath, dest);
  } catch (error) {
    await rm(partPath, { force: true });
    throw error;
  }
}

/** 받은(또는 캐시된) 빌드 파일 경로를 돌려준다. 목록을 읽은 직후 받는다(링크 1시간 만료). */
export async function fetchBuild(input: BuildInput, deps: BuildDeps): Promise<string> {
  const releases = await listReleases(firebaseAppId(input.platform, input.kind, deps.install), deps.fetchJson);
  const release = pickRelease(releases, input.version);
  if (!release) throw new Error(`${input.platform} ${input.kind} ${input.version} 빌드가 Firebase에 없습니다.`);
  const dest = cachePath(input, release, deps.root ?? process.cwd());
  if (await exists(dest)) return dest;
  await mkdir(path.dirname(dest), { recursive: true });
  try {
    await downloadAtomically(release.binaryDownloadUri, dest, deps);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`${input.platform} ${input.kind} ${input.version} 빌드를 받지 못했습니다: ${reason}`, { cause: error });
  }
  return dest;
}

async function downloadToFile(url: string, dest: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`다운로드 실패 HTTP ${response.status}`);
  await pipeline(Readable.fromWeb(response.body as NodeReadableStream<Uint8Array>), createWriteStream(dest));
}

/** 서비스 계정(`FIREBASE_SERVICE_ACCOUNT`) 토큰으로 목록을 읽고, 서명된 링크는 그대로 받는다. */
export function defaultBuildDeps(install?: Pick<InstallConfig, "firebase">, root?: string): BuildDeps {
  let auth: GoogleAuth | null = null;
  const fetchJson: FetchJson = async (url) => {
    const keyFile = process.env.FIREBASE_SERVICE_ACCOUNT?.trim();
    if (!keyFile) throw new Error("FIREBASE_SERVICE_ACCOUNT이 비어 있습니다.");
    auth ??= new GoogleAuth({ keyFile, scopes: [cloudPlatformScope] });
    const client = await auth.getClient();
    const response = await client.request<unknown>({ url });
    return response.data;
  };
  return { fetchJson, download: downloadToFile, root, install };
}

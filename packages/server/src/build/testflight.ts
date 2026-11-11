import { readFileSync } from "node:fs";
import { sign } from "node:crypto";

export interface TestflightBuild {
  id: string;
  version: string;
  build: string;
  uploadedDate: string;
}

export interface AscKey {
  keyId: string;
  issuerId: string;
  privateKey: string;
}

export type FetchJson = (url: string) => Promise<unknown>;

export const ascTokenTtlSeconds = 20 * 60;
const ascAudience = "appstoreconnect-v1";
const ascBuildsUrl = "https://api.appstoreconnect.apple.com/v1/builds";
const ascBuildsLimit = 20;

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}이 비어 있습니다.`);
  return value;
}

export function ascKeyFromEnv(): AscKey {
  return {
    keyId: requireEnv("ASC_KEY_ID"),
    issuerId: requireEnv("ASC_ISSUER_ID"),
    privateKey: readFileSync(requireEnv("ASC_PRIVATE_KEY_PATH"), "utf8"),
  };
}

/** App Store Connect 앱 ID. 운영과 dev(`.dev` 번들)는 다른 앱이다. */
export function ascAppId(kind: "dev" | "prod" = "prod"): string {
  return requireEnv(kind === "dev" ? "ASC_APP_ID_DEV" : "ASC_APP_ID");
}

function base64UrlJson(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

/** App Store Connect API용 ES256 JWT. `now`는 ms. */
export function ascToken(now: number, key: AscKey = ascKeyFromEnv()): string {
  const iat = Math.floor(now / 1000);
  const header = base64UrlJson({ alg: "ES256", kid: key.keyId, typ: "JWT" });
  const payload = base64UrlJson({ iss: key.issuerId, iat, exp: iat + ascTokenTtlSeconds, aud: ascAudience });
  const signingInput = `${header}.${payload}`;
  const signature = sign("sha256", Buffer.from(signingInput), { key: key.privateKey, dsaEncoding: "ieee-p1363" });
  return `${signingInput}.${signature.toString("base64url")}`;
}

/** env의 ASC 키로 매 요청 토큰을 새로 만들어 JSON을 읽는다. */
export function ascFetchJson(now: () => number = Date.now): FetchJson {
  return async (url) => {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${ascToken(now())}` } });
    if (!response.ok) throw new Error(`App Store Connect HTTP ${response.status}`);
    return response.json();
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function field(value: unknown, ...keys: string[]): unknown {
  return keys.reduce<unknown>((current, key) => (isRecord(current) ? current[key] : undefined), value);
}

function preReleaseVersions(included: unknown): Map<string, string> {
  const versions = new Map<string, string>();
  if (!Array.isArray(included)) return versions;
  for (const item of included) {
    const id = field(item, "id");
    const version = field(item, "attributes", "version");
    if (field(item, "type") === "preReleaseVersions" && typeof id === "string" && typeof version === "string") {
      versions.set(id, version);
    }
  }
  return versions;
}

function toBuild(item: unknown, versions: Map<string, string>): TestflightBuild | null {
  const id = field(item, "id");
  const build = field(item, "attributes", "version");
  const uploadedDate = field(item, "attributes", "uploadedDate");
  const preReleaseId = field(item, "relationships", "preReleaseVersion", "data", "id");
  const version = typeof preReleaseId === "string" ? versions.get(preReleaseId) : undefined;
  if (typeof id !== "string" || typeof build !== "string" || typeof uploadedDate !== "string" || !version) return null;
  return { id, version, build, uploadedDate };
}

/** 최근 업로드 순. 처리 상태와 관계없이 올라온 빌드를 모두 돌려준다. */
export async function listTestflightBuilds(fetchJson: FetchJson, appId: string): Promise<TestflightBuild[]> {
  const query = `filter[app]=${encodeURIComponent(appId)}&sort=-uploadedDate&limit=${ascBuildsLimit}&include=preReleaseVersion`;
  const body = await fetchJson(`${ascBuildsUrl}?${query}`);
  const data = field(body, "data");
  if (!Array.isArray(data)) throw new Error("App Store Connect 빌드 목록 응답 형식이 다릅니다.");
  const versions = preReleaseVersions(field(body, "included"));
  return data.map((item) => toBuild(item, versions)).filter((build): build is TestflightBuild => build !== null);
}

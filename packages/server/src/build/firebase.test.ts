import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { fetchBuild, firebaseAppId, listReleases, pickRelease, type Release } from "./firebase";

function release(displayVersion: string, buildVersion: string, createTime: string): Release {
  return {
    name: `projects/1/apps/a/releases/${displayVersion}-${buildVersion}`,
    displayVersion,
    buildVersion,
    createTime,
    binaryDownloadUri: `https://example.test/${displayVersion}-${buildVersion}`,
  };
}

const older = release("2.1.5", "411", "2026-10-01T00:00:00Z");
const newer = release("2.1.5", "412", "2026-10-02T00:00:00Z");
const other = release("2.1.4", "400", "2026-09-01T00:00:00Z");
const releases = [older, newer, other];

// pickRelease
assert.equal(pickRelease(releases, "2.1.5"), newer);
assert.equal(pickRelease(releases, "2.1.5+411"), older);
assert.equal(pickRelease(releases, "9.9.9"), null);
assert.equal(pickRelease(releases, "2.1.5+999"), null);

// listReleases: 두 페이지를 합친다
const appId = "1:426098194254:android:abc";
const requested: string[] = [];
const pages: Record<string, unknown> = {
  first: { releases: [older], nextPageToken: "p2" },
  second: { releases: [newer, other] },
};
const pagedFetch = async (url: string) => {
  requested.push(url);
  return url.includes("pageToken=p2") ? pages.second : pages.first;
};
const listed = await listReleases(appId, pagedFetch);
assert.equal(listed.length, 3);
assert.equal(
  requested[0],
  "https://firebaseappdistribution.googleapis.com/v1/projects/426098194254/apps/1:426098194254:android:abc/releases",
);
assert.equal(requested.length, 2);

// firebaseAppId
process.env.FIREBASE_APP_ANDROID_PROD = "";
assert.throws(() => firebaseAppId("android", "prod"), { message: "FIREBASE_APP_ANDROID_PROD이 비어 있습니다." });
delete process.env.FIREBASE_APP_IOS_DEV;
assert.throws(() => firebaseAppId("ios", "dev"), { message: "FIREBASE_APP_IOS_DEV이 비어 있습니다." });
// 환경 변수가 비면 앱 설정을 본다
assert.equal(firebaseAppId("ios", "dev", { firebase: { ios: { dev: "1:111:ios:sample" } } }), "1:111:ios:sample");
process.env.FIREBASE_APP_IOS_DEV = "1:222:ios:env";
assert.equal(firebaseAppId("ios", "dev", { firebase: { ios: { dev: "1:111:ios:sample" } } }), "1:222:ios:env");

// fetchBuild
process.env.FIREBASE_APP_ANDROID_DEV = appId;
const root = await mkdtemp(path.join(tmpdir(), "device-farm-firebase-"));
const cacheDir = path.join(root, "test-results/builds");
const listFetch = async () => ({ releases });

const failingDownload = async (_url: string, dest: string) => {
  await writeFile(dest, "half");
  throw new Error("socket hang up");
};
await assert.rejects(
  fetchBuild({ platform: "android", kind: "dev", version: "2.1.5" }, { fetchJson: listFetch, download: failingDownload, root }),
  (error: Error) => error.message.includes("2.1.5") && error.message.includes("socket hang up"),
);
assert.deepEqual(await readdir(cacheDir), []);

await assert.rejects(
  fetchBuild({ platform: "android", kind: "dev", version: "3.0.0" }, { fetchJson: listFetch, download: failingDownload, root }),
  { message: "android dev 3.0.0 빌드가 Firebase에 없습니다." },
);

let downloads = 0;
const okDownload = async (_url: string, dest: string) => {
  downloads += 1;
  await writeFile(dest, "apk");
};
const deps = { fetchJson: listFetch, download: okDownload, root };
const saved = await fetchBuild({ platform: "android", kind: "dev", version: "2.1.5" }, deps);
assert.equal(saved, path.join(cacheDir, "android-dev-2.1.5-412.apk"));
assert.deepEqual(await readdir(cacheDir), ["android-dev-2.1.5-412.apk"]);
await fetchBuild({ platform: "android", kind: "dev", version: "2.1.5+412" }, deps);
assert.equal(downloads, 1);

await rm(root, { recursive: true, force: true });
console.log("firebase ok");

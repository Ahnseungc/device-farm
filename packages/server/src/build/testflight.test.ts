import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";

import { ascToken, listTestflightBuilds } from "./testflight";

// ascToken: 테스트에서 만든 P-256 키로 서명을 검증한다
const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const key = {
  keyId: "KEY123",
  issuerId: "issuer-uuid",
  privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
};
const now = 1_790_000_000_500;
const token = ascToken(now, key);
const [header, payload, signature] = token.split(".");
const decode = (part: string) => JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
assert.deepEqual(decode(header), { alg: "ES256", kid: "KEY123", typ: "JWT" });
assert.deepEqual(decode(payload), { iss: "issuer-uuid", iat: 1_790_000_000, exp: 1_790_001_200, aud: "appstoreconnect-v1" });
assert.equal(Buffer.from(signature, "base64url").length, 64);
assert.equal(
  verify("sha256", Buffer.from(`${header}.${payload}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(signature, "base64url")),
  true,
);

// listTestflightBuilds: 실제 ASC 응답 모양 픽스처
const fixture = {
  data: [
    {
      type: "builds",
      id: "build-412",
      attributes: { version: "412", uploadedDate: "2026-10-22T10:00:00.000-07:00", processingState: "PROCESSING" },
      relationships: { preReleaseVersion: { data: { type: "preReleaseVersions", id: "prv-215" } } },
    },
    {
      type: "builds",
      id: "build-411",
      attributes: { version: "411", uploadedDate: "2026-10-21T10:00:00.000-07:00", processingState: "VALID" },
      relationships: { preReleaseVersion: { data: { type: "preReleaseVersions", id: "prv-215" } } },
    },
  ],
  included: [{ type: "preReleaseVersions", id: "prv-215", attributes: { version: "2.1.5", platform: "IOS" } }],
  links: { self: "https://api.appstoreconnect.apple.com/v1/builds" },
};
let requestedUrl = "";
const builds = await listTestflightBuilds(async (url) => {
  requestedUrl = url;
  return fixture;
}, "1234567890");
assert.equal(
  requestedUrl,
  "https://api.appstoreconnect.apple.com/v1/builds?filter[app]=1234567890&sort=-uploadedDate&limit=20&include=preReleaseVersion",
);
assert.deepEqual(builds, [
  { id: "build-412", version: "2.1.5", build: "412", uploadedDate: "2026-10-22T10:00:00.000-07:00" },
  { id: "build-411", version: "2.1.5", build: "411", uploadedDate: "2026-10-21T10:00:00.000-07:00" },
]);
await assert.rejects(listTestflightBuilds(async () => ({ errors: [] }), "1"));

console.log("testflight ok");

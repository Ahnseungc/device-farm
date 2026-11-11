import assert from "node:assert/strict";

import { defaultPort, parseExploreArgs, parseRunArgs } from "./args";

const run = parseRunArgs(["--build", "prod", "--version", "2.1.5"]);
assert.deepEqual(run, { ok: true, value: { kind: "prod", version: "2.1.5", devices: "all", port: defaultPort } });

const full = parseRunArgs(["--build=dev", "--version", "2.1.5+412", "--devices", "a,b", "--port", "6000"]);
assert.deepEqual(full, { ok: true, value: { kind: "dev", version: "2.1.5+412", devices: ["a", "b"], port: 6000 } });

const missingBuild = parseRunArgs(["--version", "2.1.5"]);
assert.equal(missingBuild.ok, false);
assert.ok(!missingBuild.ok && missingBuild.error.includes("--build"));

assert.equal(parseRunArgs(["--build", "beta", "--version", "2.1.5"]).ok, false);
assert.equal(parseRunArgs(["--build", "dev"]).ok, false);
assert.equal(parseRunArgs(["--build", "dev", "--version", "2.1"]).ok, false);
assert.equal(parseRunArgs(["--build", "dev", "--version", "2.1.5+"]).ok, false);
assert.equal(parseRunArgs(["--build", "dev", "--version", "2.1.5", "--devices", "a,,b"]).ok, false);
assert.equal(parseRunArgs(["--build", "dev", "--version", "2.1.5", "--port", "abc"]).ok, false);
assert.equal(parseRunArgs(["--build", "dev", "--version", "2.1.5", "--port", "70000"]).ok, false);
assert.equal(parseRunArgs(["--build", "dev", "--version", "2.1.5", "--nope", "1"]).ok, false);
assert.equal(parseRunArgs(["--build", "--version", "2.1.5"]).ok, false);
assert.equal(parseRunArgs(["prod"]).ok, false);

assert.deepEqual(parseExploreArgs([]), { ok: true, value: { devices: "all", port: defaultPort } });
assert.deepEqual(parseExploreArgs(["--devices", "x", "--build", "dev"]), { ok: true, value: { devices: ["x"], port: defaultPort, build: "dev" } });
assert.equal(parseExploreArgs(["--version", "2.1.5"]).ok, false);

console.log("args ok");

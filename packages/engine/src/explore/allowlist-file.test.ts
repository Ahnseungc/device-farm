import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadAllowlist } from "./allowlist-file";

const dir = await mkdtemp(join(tmpdir(), "policy-"));
try {
  const file = join(dir, "allowlist.json");
  await writeFile(file, JSON.stringify({ entries: [{ method: "POST", path: "/a", status: "allow", note: "" }] }));
  assert.equal((await loadAllowlist(file)).entries.length, 1);
  await writeFile(file, "{ broken");
  await assert.rejects(loadAllowlist(file));
} finally {
  await rm(dir, { recursive: true, force: true });
}
assert.deepEqual(await loadAllowlist(), { entries: [] });

console.log("allowlist-file ok");

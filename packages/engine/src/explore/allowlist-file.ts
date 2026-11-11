import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { parseAllowlist, type Allowlist } from "@device-farm/core/explore/policy";

/** 레포 루트 `explore/allowlist.json`. 사람이 고른 쓰기 API 허용 목록 */
export const defaultAllowlistFile = fileURLToPath(new URL("../../../../explore/allowlist.json", import.meta.url));

export async function loadAllowlist(file = defaultAllowlistFile): Promise<Allowlist> {
  const text = await readFile(file, "utf8");
  return parseAllowlist(JSON.parse(text));
}

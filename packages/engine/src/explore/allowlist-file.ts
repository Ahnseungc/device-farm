import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { parseAllowlist, type Allowlist } from "@device-farm/core/explore/policy";

/** 작업 폴더(사용자 프로젝트) `explore/allowlist.json`. 사람이 고른 쓰기 API 허용 목록 */
export const defaultAllowlistFile = path.resolve("explore/allowlist.json");

/** 파일이 없으면 빈 목록(모든 쓰기 요청을 막는다) */
export async function loadAllowlist(file = defaultAllowlistFile): Promise<Allowlist> {
  if (!existsSync(file)) return { entries: [] };
  const text = await readFile(file, "utf8");
  return parseAllowlist(JSON.parse(text));
}

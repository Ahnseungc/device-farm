import { writeFile } from "node:fs/promises";

import { addMissingAsDeny, isMutatingMethod } from "@device-farm/core/explore/policy";
import type { WriteOperation } from "@device-farm/core/explore/policy";
import { defaultAllowlistFile, loadAllowlist } from "@device-farm/engine/explore/allowlist-file";

/** OpenAPI `paths`에서 쓰기 API(method + path)만 모은다. */
function collectWriteOperations(spec: unknown): WriteOperation[] {
  if (typeof spec !== "object" || spec === null || !("paths" in spec)) throw new Error("OpenAPI 스펙에 paths가 없습니다.");
  const { paths } = spec;
  if (typeof paths !== "object" || paths === null) throw new Error("OpenAPI paths가 객체가 아닙니다.");
  const operations: WriteOperation[] = [];
  for (const [path, item] of Object.entries(paths)) {
    if (typeof item !== "object" || item === null) continue;
    for (const method of Object.keys(item)) {
      const upper = method.toUpperCase();
      if (isMutatingMethod(upper)) operations.push({ method: upper, path });
    }
  }
  return operations;
}

async function fetchSpec(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`OpenAPI 스펙을 못 받았습니다: ${response.status} ${url}`);
  return response.json();
}

/** 목록에 없는 쓰기 API를 deny로만 추가한다. allow는 사람이 고른다. */
async function main(): Promise<void> {
  const url = process.env.FARM_OPENAPI_URL;
  if (!url) throw new Error("FARM_OPENAPI_URL이 비어 있습니다.");
  const operations = collectWriteOperations(await fetchSpec(url));
  const current = await loadAllowlist();
  const { allowlist, added } = addMissingAsDeny(current, operations);
  await writeFile(defaultAllowlistFile, `${JSON.stringify(allowlist, null, 2)}\n`);
  console.log(`쓰기 API ${operations.length}개 중 ${added}개를 deny로 추가했습니다. (${defaultAllowlistFile})`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

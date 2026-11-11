import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { parseAllowlist, type Allowlist } from "@device-farm/core/explore/policy";
import { defaultAllowlistFile } from "@device-farm/engine/explore/allowlist-file";

export const formValuesFile = fileURLToPath(new URL("../../../explore/form-values.json", import.meta.url));

/** 입력칸 라벨 → 테스트 값. 문자열이 아닌 값이 있으면 throw(잘못된 값으로 탐색을 시작하지 않는다). */
export function parseFormValues(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("form-values: { 라벨: 값 } 형식이 아닙니다.");
  const entries = Object.entries(value);
  if (entries.some(([, item]) => typeof item !== "string")) throw new Error("form-values: 값은 문자열이어야 합니다.");
  return Object.fromEntries(entries) as Record<string, string>;
}

/** 탐색 시작 때마다 다시 읽는다. 사람이 파일을 고치면 서버 재시작 없이 반영된다. */
export function loadExploreInputs(allowlistFile = defaultAllowlistFile, valuesFile = formValuesFile): { allowlist: Allowlist; formValues: Record<string, string> } {
  return {
    allowlist: parseAllowlist(JSON.parse(readFileSync(allowlistFile, "utf8"))),
    formValues: parseFormValues(JSON.parse(readFileSync(valuesFile, "utf8"))),
  };
}

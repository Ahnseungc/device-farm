// PRD → 플로우 후보 생성.
import type { AppConfig } from "@device-farm/core/config/app-config";
import { generationPrompt, parseModelJson } from "@device-farm/core/flows/prompt";

import { complete, llmConfigured } from "./llm";
import { acceptGenerated, flowDirs, prdHash, readHashes, readPrd, readReady, writeCandidates, writeHash } from "./store";

export type GenerateResult =
  | { ok: true; generated: number; skipped: boolean; reason?: string }
  | { ok: false; status: 400 | 502; error: string };

export const llmMissingReason = "FLOW_LLM_API_KEY·FLOW_LLM_BASE_URL·FLOW_LLM_MODEL이 없어 생성을 건너뜁니다.";
export const sameHashReason = "PRD가 지난 생성 뒤 바뀌지 않았습니다.";

/** PRD 하나에서 후보를 만든다. PRD가 그대로거나 LLM 키가 없으면 건너뛴다(실패가 아니다). */
export async function generateFromPrd(app: AppConfig, name: string, dirs = flowDirs, llm = complete): Promise<GenerateResult> {
  const body = readPrd(name);
  if (body == null) return { ok: false, status: 400, error: `PRD를 찾지 못했습니다: ${name}` };
  const hash = prdHash(body);
  if (readHashes(dirs)[name] === hash) return { ok: true, generated: 0, skipped: true, reason: sameHashReason };
  if (llm === complete && !llmConfigured()) return { ok: true, generated: 0, skipped: true, reason: llmMissingReason };
  const result = await llm(generationPrompt({ app, prdName: name, prdBody: body, ready: readReady(dirs) }));
  if (!result.ok) return { ok: false, status: 502, error: "LLM이 답하지 않았습니다." };
  const items = parseModelJson(result.text);
  if (!items) return { ok: false, status: 502, error: "LLM 답이 JSON 배열이 아닙니다." };
  const accepted = acceptGenerated(items, name, body, app.guard.forbiddenClickNames, dirs);
  writeCandidates(name, accepted, dirs);
  writeHash(name, hash, dirs);
  return { ok: true, generated: accepted.length, skipped: false };
}

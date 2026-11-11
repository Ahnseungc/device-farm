/**
 * 프론트(Next.js App Router) 코드에서 화면(라우트) → 피그마 노드를 찾는다. 사람이 잇지 않는다(docs/design-policy-figma.md 「출처」).
 * 재료: 스토리북 `parameters.figma` 링크(`figma.com/design/<key>/?node-id=1-2`)와 주석 `Figma 42604:347085`.
 * 여기는 `git grep` 출력 해석만 한다(실행은 engine).
 */

/**
 * `app/` 아래 파일 → 화면 경로. 라우트 그룹 `(x)`는 빼고, `_`로 시작하는 비공개 폴더나 파일에서 멈춘다. `[id]`는 `*`.
 * 예: `app/(protected)/(shop)/my/orders/_src/A.tsx` → `/my/orders`
 */
export function routeOfFile(file: string, appDir = "app"): string | null {
  const prefix = appDir.split("/").filter(Boolean);
  const all = file.split("/");
  if (prefix.some((part, index) => all[index] !== part)) return null;
  const parts = ["app", ...all.slice(prefix.length)];
  const route: string[] = [];
  for (const part of parts.slice(1, -1)) {
    if (part.startsWith("_") || part.startsWith("@")) break;
    if (part.startsWith("(") && part.endsWith(")")) continue;
    route.push(part.startsWith("[") ? "*" : part);
  }
  return `/${route.join("/")}`;
}

const linkPattern = /figma\.com\/(?:design|file|proto)\/([A-Za-z0-9]+)[^"'`\s<>]*?node-id=([0-9]+)(?:-|%3A|:)([0-9]+)/g;
const commentPattern = /Figma\s+([0-9]+):([0-9]+)/g;

export interface FrontFigmaLine {
  file: string;
  text: string;
}

/** `git grep -n <ref>` 줄(`ref:path:line:text`)을 파일·글자로. ref를 안 붙인 출력(`path:line:text`)도 읽는다 */
export function parseGrepLine(line: string, ref: string): FrontFigmaLine | null {
  const body = line.startsWith(`${ref}:`) ? line.slice(ref.length + 1) : line;
  const match = /^([^:]+):\d+:(.*)$/.exec(body);
  return match ? { file: match[1], text: match[2] } : null;
}

/**
 * 화면 경로 → `fileKey:nodeId` 목록. 주석은 파일 키가 없어서 같은 화면 링크에서 가장 많이 쓴 키, 없으면 전체에서 가장 많이 쓴 키를 붙인다.
 */
export function buildFrontFigmaMap(lines: readonly FrontFigmaLine[], appDir = "app"): Record<string, string[]> {
  const links = new Map<string, Set<string>>();
  const comments = new Map<string, Set<string>>();
  const keyCount = new Map<string, Map<string, number>>();
  const add = (map: Map<string, Set<string>>, route: string, value: string) => map.set(route, (map.get(route) ?? new Set()).add(value));
  for (const { file, text } of lines) {
    const route = routeOfFile(file, appDir);
    if (!route) continue;
    for (const match of text.matchAll(linkPattern)) {
      add(links, route, `${match[1]}:${match[2]}:${match[3]}`);
      const counts = keyCount.get(route) ?? new Map<string, number>();
      keyCount.set(route, counts.set(match[1], (counts.get(match[1]) ?? 0) + 1));
    }
    for (const match of text.matchAll(commentPattern)) add(comments, route, `${match[1]}:${match[2]}`);
  }
  const topKey = (counts: Map<string, number> | undefined) => [...(counts ?? new Map<string, number>()).entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const allCounts = new Map<string, number>();
  for (const counts of keyCount.values()) for (const [key, count] of counts) allCounts.set(key, (allCounts.get(key) ?? 0) + count);
  const fallbackKey = topKey(allCounts);
  const result: Record<string, string[]> = {};
  for (const route of new Set([...links.keys(), ...comments.keys()])) {
    const refs = new Set(links.get(route));
    const key = topKey(keyCount.get(route)) ?? fallbackKey;
    if (key) for (const node of comments.get(route) ?? []) refs.add(`${key}:${node}`);
    if (refs.size > 0) result[route] = [...refs].sort();
  }
  return result;
}

import type { BlockedRequest } from "./guard";
import type { Issue } from "./probe";

/**
 * 탐색 점검이 다루는 동작·결과 타입과, 화면에서 버튼·링크·입력칸을 고르는 DOM 스크립트, 금지어 판정.
 * 크롤러(engine)·버튼 눌러보기·에이전트 세션·화면이 같은 규칙을 쓰도록 여기 한 곳에 둔다.
 * 금지어 목록은 앱 설정(`AppConfig.guard.forbiddenButtonWords`)에서 받는다.
 */
export type ExploreAction =
  | { kind: "click"; role: "button" | "link"; name: string }
  | { kind: "fill"; label: string; value: string };

export interface ExplorePath {
  id: string;
  actions: ExploreAction[];
}

export interface ExploreIssue extends Issue {
  pathId: string;
  /** crawl은 비워 둔다. run.ts가 실패 묶음을 쓰고 채운다. */
  screenshot: string;
  logDir: string;
}

export interface ExploreRun {
  runId: string;
  deviceId: string;
  startedAt: string;
  finishedAt: string | null;
  paths: ExplorePath[];
  issues: ExploreIssue[];
  blocked: Array<BlockedRequest & { pathId: string }>;
  cleanPathIds: string[];
  /** 스펙 밖 추가 필드: 재생 중 동작이 실패한 경로. cleanPathIds에서 빠진다. */
  replayFailures: Array<{ pathId: string; message: string }>;
}

/** 브라우저 식 공통 함수. 목록·클릭·입력 식이 같은 이름 규칙을 쓰도록 한 곳에 둔다. */
const domHelpers = `
  const nameOf = (el) => (el.getAttribute("aria-label") || el.innerText || el.value || el.title || el.getAttribute("alt") || "").replace(/\\s+/g, " ").trim();
  const isVisible = (el) => {
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const style = getComputedStyle(el);
    return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
  };
  const isEnabled = (el) => !el.disabled && el.getAttribute("aria-disabled") !== "true" && !el.closest("[inert]");
  const isUsable = (el) => isVisible(el) && isEnabled(el);
  const buttons = () => Array.from(document.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"]')).filter(isUsable);
  const isSafeLink = (el) => {
    if (el.getAttribute("target") === "_blank") return false;
    if (!el.href) return true;
    return el.href.startsWith("http://") || el.href.startsWith("https://");
  };
  const links = () => Array.from(document.querySelectorAll('a[href], [role="link"]')).filter((el) => isUsable(el) && isSafeLink(el));
  const skippedInputTypes = ["hidden", "password", "file", "checkbox", "radio", "submit", "button", "image", "reset"];
  const labelOf = (el) => (el.getAttribute("aria-label") || (el.labels && el.labels[0] ? el.labels[0].innerText : "") || el.getAttribute("placeholder") || "").replace(/\\s+/g, " ").trim();
  const inputs = () => Array.from(document.querySelectorAll("input, textarea")).filter((el) => isUsable(el) && !el.readOnly && !skippedInputTypes.includes((el.getAttribute("type") || "").toLowerCase()));
`;

export interface ActionCandidate {
  role: "button" | "link" | "input";
  name: string;
}

export const listActionsScript = `(() => {${domHelpers}
  return [
    ...buttons().map((el) => ({ role: "button", name: nameOf(el) })),
    ...links().map((el) => ({ role: "link", name: nameOf(el) })),
    ...inputs().map((el) => ({ role: "input", name: labelOf(el) })),
  ].filter((item) => item.name.length > 0);
})()`;

export function linkClickScript(name: string): string {
  return `(() => {${domHelpers}
  const target = links().find((el) => nameOf(el) === ${JSON.stringify(name)});
  if (!target) throw new Error("링크 없음: " + ${JSON.stringify(name)});
  target.click();
  return true;
})()`;
}

export function fillScript(label: string, value: string): string {
  return `(() => {${domHelpers}
  const target = inputs().find((el) => labelOf(el) === ${JSON.stringify(label)});
  if (!target) throw new Error("입력칸 없음: " + ${JSON.stringify(label)});
  const proto = target instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(target, ${JSON.stringify(value)});
  target.dispatchEvent(new Event("input", { bubbles: true }));
  target.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
})()`;
}

/** 이름에 금지어가 들어 있으면 누르지 않는다. 공백은 무시하고 비교한다 */
export function hasForbiddenWord(name: string, words: readonly string[]): boolean {
  const compact = name.replace(/\s+/g, "");
  return words.some((word) => compact.includes(word.replace(/\s+/g, "")));
}

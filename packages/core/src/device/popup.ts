/**
 * 점검·플로우 중에 뜬 팝업(모달·바텀시트) 알아보기와 닫는 순서.
 * 기기마다 같은 웹 스크립트를 앱 WebView 맨 위 페이지에서 돌린다.
 */

/** 팝업 안 버튼 하나. 가운데 자리 맨 위가 자기 자신이면 reachable(사람이 누를 수 있다) */
export interface PopupButton {
  name: string;
  reachable: boolean;
}

export interface PopupInfo {
  /** 첫 줄(제목). 없으면 「제목 없는 팝업」 */
  title: string;
  /** 팝업 안 글자 줄 */
  texts: string[];
  buttons: PopupButton[];
  /** 팝업 바깥 딤의 누를 자리(CSS px). 없으면 null */
  dim: { x: number; y: number } | null;
}

export type PopupClose = { kind: "button"; name: string } | { kind: "dim" } | { kind: "press"; name: string };

/** 점검 결과 이름: `팝업 · <제목>` */
export const popupScenarioPrefix = "팝업 · ";
export const untitledPopup = "제목 없는 팝업";
/** 닫기로 보는 버튼 이름(앞부터). 앱마다 더할 것은 `AppConfig.popups.extraCloseNames`. 「다시 보지 않기」는 다음 점검에서 그 팝업을 못 보게 되므로 누르지 않는다 (작성자 판단) */
export const popupCloseNames = ["닫기", "close", "Close", "X", "×", "확인", "취소", "나중에", "다음에", "괜찮아요"] as const;
/**
 * 점검 결과인 팝업인가(제목·글자에 `AppConfig.popups.resultTitles` 중 하나가 있으면). 플로우 중에 뜨면 닫지 않고 그 자리에서 멈춘다.
 * 시간 제한 퀴즈의 「시간이 초과됐어요」 같은 것. 닫으면 화면이 넘어가 「버튼을 찾지 못했습니다」로만 남는다.
 */
export const isResultPopup = (info: Pick<PopupInfo, "title" | "texts">, titles: readonly string[]) => titles.some((title) => info.title.includes(title) || info.texts.some((text) => text.includes(title)));

/** 플로우 중 결과 팝업에 막혔을 때의 실패 사유 */
export const resultPopupMessage = (title: string) => `「${title}」 팝업이 떠서 멈췄습니다(시간 제한 안에 다음 동작을 하지 못함). 닫지 않고 그대로 두었습니다.`;

/** 누르면 안 되는 버튼(팝업이 다시 안 뜨게 됨) */
export const popupNeverPress = ["다시 보지 않기", "오늘 하루 보지 않기", "오늘 그만 보기", "다시 보지않기"] as const;

/**
 * 맨 위에 열린 팝업. 표시(role=dialog·aria-modal)가 있거나, 화면 대부분을 덮는 딤(class에 dim·overlay·backdrop)이 맨 위에 있으면 팝업이다.
 * 팝업 본체는 딤이 아닌 쪽에서 화면 가운데·아래쪽을 누른 자리에서 위로 올라가며 화면 전체보다 작은 가장 큰 상자다.
 * 화면 전체를 덮는 고정 창(상담 채팅 메신저 등)은 닫는 길이 따로 있어(goHome) 팝업으로 보지 않는다.
 */
export const popupScript = `(() => {
  const W = innerWidth, H = innerHeight;
  const squash = (s) => String(s || "").replace(/\\s+/g, " ").trim();
  const nameOf = (el) => squash(el.getAttribute("aria-label") || el.innerText || el.title || "");
  const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0.05; };
  const dimLike = (el) => /(^|[\\s:_-])(dim|overlay|backdrop)/i.test(String(el.className)) || /(^|[\\s_-])(bg-dim|dimmed)/i.test(String(el.className));
  const big = (el) => { const r = el.getBoundingClientRect(); return r.width >= W * 0.9 && r.height >= H * 0.6; };
  const positioned = (el) => ["fixed", "absolute"].includes(getComputedStyle(el).position);
  // 이름 없는 딤: 글자 없이 화면을 덮는 어둡고 비치는 상자(퀴즈 시트 absolute inset-0 bg-black, 투명도 0.4)
  const rgba = (c) => (String(c).match(/[\\d.]+/g) || []).map(Number);
  const shade = (el) => {
    const s = getComputedStyle(el); const [r, g, b, a = 1] = rgba(s.backgroundColor);
    if (!String(s.backgroundColor).startsWith("rgb") || a === 0) return false;
    return r + g + b < 200 && (Number(s.opacity) < 0.95 || a < 0.95) && squash(el.innerText) === "";
  };
  const dimCandidates = Array.from(document.querySelectorAll("div, span, section")).filter((el) => (dimLike(el) || shade(el)) && positioned(el) && big(el) && visible(el));
  // 가장 안쪽 딤만: 팝업 층(z-overlay fixed)도 이름에 overlay가 들어 딤으로 잡히는데, 그러면 카드가 「딤 안」이라 본체를 못 찾았다
  const dims = dimCandidates.filter((el) => !dimCandidates.some((other) => other !== el && el.contains(other)));
  const onTop = (el, x, y) => { const hit = document.elementFromPoint(x, y); return Boolean(hit) && (hit === el || el.contains(hit)); };
  // 딤이 든 팝업 층: 딤의 가장 바깥 fixed 조상(없으면 딤). 딤 위에 투명한 화면 전체 상자(가운데 정렬용)가 덮여 있어도
  // 그 상자는 같은 층이라 팝업으로 본다
  const layerOf = (el) => { let layer = el; for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) if (getComputedStyle(n).position === "fixed") layer = n; return layer; };
  const probes = [[0.5, 0.06], [0.5, 0.12], [0.5, 0.94], [0.1, 0.5], [0.9, 0.5]];
  let dim = null; let dimPoint = null;
  for (const el of dims) {
    const layer = layerOf(el);
    const p = probes.find(([fx, fy]) => onTop(layer, W * fx, H * fy));
    if (p) { dim = el; dimPoint = { x: W * p[0], y: H * p[1] }; break; }
  }
  const marked = Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"]')).filter((el) => visible(el) && el.getBoundingClientRect().height < H * 0.95);
  // 전체 화면 팝업: 딤으로 잡힌 것이 불투명한 dialog 자신이면 바깥이 없다. 팝업 전체를 본체로, 딤은 없음으로 본다.
  // class 이름에 overlay가 든 흰 배경 동의서를 딤으로 보면 본문 한 칸만 본체로 잡아 닫기를 못 찾는다
  const opaque = (el) => { const s = getComputedStyle(el); const [, , , a = 1] = rgba(s.backgroundColor); return String(s.backgroundColor).startsWith("rgb") && a >= 0.95 && Number(s.opacity) >= 0.95; };
  let full = null;
  if (dim && dim.matches('[role="dialog"], [aria-modal="true"]') && opaque(dim)) { full = dim; dim = null; dimPoint = null; }
  let panel = null;
  if (full) {
    panel = full;
  } else if (dim) {
    for (const fy of [0.5, 0.7, 0.35, 0.85]) {
      let n = document.elementFromPoint(W / 2, H * fy);
      // 딤이 본체를 품은 층이면(이름 없는 딤을 못 찾은 경우) 그 딤 바로 아래까지 올라간다
      if (!n || n === dim || !layerOf(dim).contains(n)) continue;
      let best = null;
      for (; n && n !== document.body; n = n.parentElement) {
        if (n === dim || n.contains(dim)) break;
        const r = n.getBoundingClientRect();
        if (r.width >= W * 0.98 && r.height >= H * 0.95) break;
        best = n;
      }
      if (best) { panel = best; break; }
    }
  } else if (marked.length > 0) {
    panel = marked[marked.length - 1];
    if (!["0.5,0.5", "0.5,0.75"].some((k) => { const [fx, fy] = k.split(",").map(Number); return onTop(panel, W * fx, H * fy); })) panel = null;
  }
  if (!panel) return null;
  const texts = String(panel.innerText || "").split("\\n").map(squash).filter(Boolean);
  if (texts.length === 0) return null;
  const buttons = Array.from(panel.querySelectorAll('button, [role="button"], a[href], [role="link"]')).filter(visible).map((el) => {
    const r = el.getBoundingClientRect();
    return { name: nameOf(el), reachable: onTop(el, r.x + r.width / 2, r.y + r.height / 2) };
  }).filter((b) => b.name);
  // 제목: 제목 요소(h1~h6·role=heading)가 있으면 그것, 없으면 버튼 글자가 아닌 첫 줄(닫기 「X」를 제목으로 잡지 않게)
  const heading = Array.from(panel.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"]')).map((el) => squash(el.innerText)).find(Boolean);
  const buttonTexts = new Set(buttons.map((b) => b.name).concat(Array.from(panel.querySelectorAll('button, [role="button"]')).map((el) => squash(el.innerText))));
  const title = (full && squash(full.getAttribute("aria-label"))) || heading || texts.find((line) => !buttonTexts.has(line)) || texts[0];
  return { title: title.slice(0, 60), texts: texts.slice(0, 40), buttons, dim: dimPoint };
})()`;

/**
 * 사람처럼 닫는 순서: 닫기류 버튼 → 바깥 딤 → 닫기류 버튼이 없고 누를 버튼이 하나뿐이면 그것(「이동」 하나뿐인 안내).
 * 「다시 보지 않기」는 고르지 않는다.
 */
/** canTapDim: 기기가 아무 자리나 누를 수 있나(ScreenDriver.tapAt) */
export function popupCloseSteps(info: PopupInfo, canTapDim = true, extraCloseNames: readonly string[] = []): PopupClose[] {
  const usable = info.buttons.filter((button) => button.reachable && !(popupNeverPress as readonly string[]).includes(button.name));
  const steps: PopupClose[] = [];
  for (const name of [...popupCloseNames, ...extraCloseNames]) {
    if (usable.some((button) => button.name === name)) steps.push({ kind: "button", name });
  }
  if (info.dim && canTapDim) steps.push({ kind: "dim" });
  // 닫기류 버튼이 없고 누를 버튼이 하나뿐이면 딤이 안 먹을 때 그것을 누른다
  const names = [...new Set(usable.map((button) => button.name))];
  if (!steps.some((step) => step.kind === "button") && names.length === 1) steps.push({ kind: "press", name: names[0] });
  return steps;
}

/** 결과 메시지에 쓰는 닫은 방법 */
export function popupCloseLabel(step: PopupClose | null): string {
  if (!step) return "닫지 못함";
  if (step.kind === "dim") return "바깥 딤을 눌러 닫음";
  if (step.kind === "button") return `「${step.name}」로 닫음`;
  return `닫기가 없어 「${step.name}」을 누름`;
}

/** 이 이름의 버튼이 팝업 안에 있나(플로우가 팝업 안 버튼을 누르려는 것이면 팝업을 닫지 않는다) */
export function popupHasButton(info: PopupInfo, name: string, match: "exact" | "prefix" = "exact"): boolean {
  return info.buttons.some((button) => (match === "prefix" ? button.name.startsWith(name) : button.name === name));
}

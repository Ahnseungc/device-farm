/**
 * 화면 깨짐 점검: 열린 웹 화면의 요소 위치·크기로 레이아웃이 깨졌는지 본다.
 * 스크린샷 비교가 아니라 DOM 측정이라 데이터가 바뀌어도 흔들리지 않는다.
 * 여기는 측정 스크립트(문자열)와 판정만 둔다. 실행은 engine.
 */

import type { QaCheck } from "../qa/rules";

export interface LayoutBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 문제 요소 하나. label은 사람이 찾을 글자(없으면 태그) */
export interface LayoutItem {
  label: string;
  box: LayoutBox;
}

export interface LayoutFacts {
  viewport: { width: number; height: number };
  /** 문서가 화면 폭보다 넓어 좌우로 밀린다 */
  pageOverflow: boolean;
  /** 화면 가장자리에 걸쳐 일부가 밖으로 나간 요소(잘라 주는 부모가 없는 것) */
  outside: LayoutItem[];
  /** 말줄임 없이 영역 밖으로 넘쳐 잘린 글자 */
  clipped: LayoutItem[];
  /** 서로 겹친 글자 쌍. 둘 다 그 자리 맨 위에 보이는 것만 */
  overlaps: [LayoutItem, LayoutItem][];
  /** 바닥에 붙인 고정 영역이 화면 아래로 잘린 것 */
  cutBottom: LayoutItem[];
  /** 글자·이미지가 하나도 없는 화면 */
  blank: boolean;
}

/** 결과 한 줄에 보여 줄 요소 수 (작성자 판단) */
export const maxLayoutExamples = 3;

/**
 * 글자 영역(Range)을 자기·조상의 overflow 영역으로 자른 실제 보이는 영역. 페이지에서 도는 JS 원문.
 * Range는 말줄임(truncate)으로 가려진 글자 폭까지 잡아 옆 버튼과 겹친다고 오탐했다(배너 제목 ↔ 「참여하기」).
 * clips: { left, top, right, bottom, x, y } — x·y는 그 방향을 잘라 주는지
 */
export const visibleRectSource = `(r, clips) => {
  let left = r.left, top = r.top, right = r.right, bottom = r.bottom;
  for (const c of clips) {
    if (c.x) { left = Math.max(left, c.left); right = Math.min(right, c.right); }
    if (c.y) { top = Math.max(top, c.top); bottom = Math.min(bottom, c.bottom); }
  }
  const width = Math.max(0, right - left), height = Math.max(0, bottom - top);
  return { x: left, y: top, left, top, right: left + width, bottom: top + height, width, height };
}`;

/**
 * 측정 스크립트. 움직이는 요소(띠배너 흐름·캐러셀 애니메이션)는 뺀다 — 일부러 화면 밖을 지나간다.
 * 겹침은 글자 자체 영역(Range)을 잘라 주는 영역으로 자른 보이는 영역으로 보고, 그 자리 맨 위가 자기 자신일 때만 센다(팝업 아래 깔린 화면 글자 제외).
 */
export const layoutScript = `(() => {
  const vw = document.documentElement.clientWidth;
  const vh = innerHeight;
  const round = (r) => ({ x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) });
  const labelOf = (el) => (el.getAttribute("aria-label") || el.innerText || el.getAttribute("alt") || "").replace(/\\s+/g, " ").trim().slice(0, 40) || el.tagName.toLowerCase();
  const item = (el, rect) => ({ label: labelOf(el), box: round(rect || el.getBoundingClientRect()) });
  const isVisible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const s = getComputedStyle(el);
    return s.display !== "none" && s.visibility !== "hidden" && Number(s.opacity) > 0.05;
  };
  const isMoving = (el) => {
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
      if (n.getAnimations && n.getAnimations().some((a) => a.playState === "running")) return true;
    }
    return false;
  };
  const clipAncestor = (el) => {
    for (let n = el.parentElement; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (/(hidden|clip|auto|scroll)/.test(s.overflowX)) return n;
    }
    return null;
  };
  const ownText = (el) => Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim().length > 0);
  const visibleRect = ${visibleRectSource};
  const clipsOf = (el) => {
    const clips = [];
    for (let n = el; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
      const s = getComputedStyle(n);
      const x = /(hidden|clip|auto|scroll)/.test(s.overflowX), y = /(hidden|clip|auto|scroll)/.test(s.overflowY);
      if (!x && !y) continue;
      const b = n.getBoundingClientRect();
      clips.push({ left: b.left, top: b.top, right: b.right, bottom: b.bottom, x, y });
    }
    return clips;
  };
  const textRect = (el) => { const range = document.createRange(); range.selectNodeContents(el); return visibleRect(range.getBoundingClientRect(), clipsOf(el)); };
  const onTop = (el, r) => { const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return Boolean(hit) && (hit === el || el.contains(hit) || hit.contains(el)); };
  const outermost = (list) => list.filter((el) => !list.some((other) => other !== el && other.contains(el)));

  const all = Array.from(document.body.querySelectorAll("*")).filter(isVisible);
  const pageOverflow = document.documentElement.scrollWidth > vw + 1;
  const outside = outermost(all.filter((el) => {
    const r = el.getBoundingClientRect();
    const crossesRight = r.left < vw - 1 && r.right > vw + 1;
    const crossesLeft = r.right > 1 && r.left < -1;
    const fullyOut = r.left >= vw || r.right <= 0;
    if (!crossesRight && !crossesLeft && !(pageOverflow && fullyOut)) return false;
    if (getComputedStyle(el).position === "fixed" && fullyOut) return false;
    return !clipAncestor(el) && !isMoving(el);
  }));

  const texts = all.filter(ownText);
  const clipped = texts.filter((el) => {
    const s = getComputedStyle(el);
    if (s.textOverflow === "ellipsis" || (s.webkitLineClamp && s.webkitLineClamp !== "none") || isMoving(el)) return false;
    const cutX = /(hidden|clip)/.test(s.overflowX) && el.scrollWidth > el.clientWidth + 1;
    const cutY = /(hidden|clip)/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 2;
    return cutX || cutY;
  });

  const shown = texts
    .map((el) => ({ el, r: textRect(el) }))
    .filter(({ el, r }) => r.width >= 2 && r.height >= 2 && r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw && !isMoving(el) && onTop(el, r))
    .slice(0, 400);
  const overlaps = [];
  for (let i = 0; i < shown.length; i += 1) {
    for (let j = i + 1; j < shown.length; j += 1) {
      const a = shown[i], b = shown[j];
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
      const h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
      if (w <= 0 || h <= 0) continue;
      const smaller = Math.min(a.r.width * a.r.height, b.r.width * b.r.height);
      if (w * h > smaller * 0.3) overlaps.push([item(a.el, a.r), item(b.el, b.r)]);
    }
  }

  const cutBottom = outermost(all.filter((el) => {
    const s = getComputedStyle(el);
    if (s.position !== "fixed" && s.position !== "sticky") return false;
    if (s.bottom === "auto") return false;
    const r = el.getBoundingClientRect();
    // 화면 전체를 덮는 팝업 딤(inset 0·100vh)은 바닥 영역이 아니다 — 일부 기기에서 innerHeight보다 길게 잡혀 오탐
    if (r.height >= vh * 0.8) return false;
    return r.top < vh && r.bottom > vh + 1;
  }));

  const media = all.some((el) => /^(IMG|CANVAS|VIDEO|SVG|IFRAME)$/i.test(el.tagName));
  const blank = document.body.innerText.trim().length === 0 && !media;
  return JSON.stringify({ viewport: { width: vw, height: vh }, pageOverflow, outside: outside.map((el) => item(el)), clipped: clipped.map((el) => item(el)), overlaps, cutBottom: cutBottom.map((el) => item(el)), blank });
})()`;

const quote = (items: readonly LayoutItem[]) => {
  const labels = [...new Set(items.map((item) => item.label))];
  const shown = labels.slice(0, maxLayoutExamples).map((label) => `「${label}」`).join(" · ");
  return labels.length > maxLayoutExamples ? `${shown} 외 ${labels.length - maxLayoutExamples}개` : shown;
};

const check = (id: string, title: string, items: readonly LayoutItem[], detail: string): QaCheck =>
  items.length === 0 ? { id, title, ok: true } : { id, title, ok: false, message: `${detail}: ${quote(items)}` };

/** 측정 결과 → 항목별 통과 여부. 항목은 늘 같은 순서로 다 낸다(통과도 보여 준다) */
export function layoutChecks(facts: LayoutFacts): QaCheck[] {
  const overlapItems = facts.overlaps.map(([a, b]) => ({ label: `${a.label}」↔「${b.label}`, box: a.box }));
  return [
    { id: "layout-blank", title: "빈 화면", ok: !facts.blank, ...(facts.blank ? { message: "글자·이미지가 하나도 없습니다" } : {}) },
    {
      ...check("layout-outside", "화면 밖으로 넘침", facts.outside, facts.pageOverflow ? "화면이 좌우로 밀립니다" : "화면 가장자리 밖으로 나갔습니다"),
      ...(facts.pageOverflow && facts.outside.length === 0 ? { ok: false, message: "화면이 좌우로 밀립니다(넘친 요소를 못 찾음)" } : {}),
    },
    check("layout-clipped", "글자 잘림", facts.clipped, "말줄임 없이 잘렸습니다"),
    check("layout-overlap", "글자 겹침", overlapItems, "글자끼리 겹칩니다"),
    check("layout-cut-bottom", "하단 고정 영역 잘림", facts.cutBottom, "화면 아래로 잘렸습니다"),
  ];
}

/** 실패 항목을 한 줄로. 모두 통과면 null */
export function layoutMessage(checks: readonly QaCheck[]): string | null {
  const failed = checks.filter((item) => !item.ok);
  return failed.length === 0 ? null : `[화면 깨짐] ${failed.map((item) => `${item.title} — ${item.message}`).join(" / ")}`;
}

export function parseLayoutFacts(raw: string): LayoutFacts {
  return JSON.parse(raw) as LayoutFacts;
}

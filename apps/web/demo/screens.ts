/**
 * 데모용 가짜 폰 화면. 가상의 쇼핑 앱 「Sample Shop」을 SVG로 그린다(실제 앱 스크린샷이 아니다).
 * 기기 화면·기준 후보·실패 묶음(기준/이번/차이)·카오스 스크린샷이 모두 여기서 나온다.
 */

const width = 360;
const height = 760;
const tabBarTop = 692;
const brand = "#4F46E5";
const font = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

export type ScreenId = "home" | "homeBroken" | "category" | "attendance" | "attendanceError" | "my" | "cart";

type Tab = "Home" | "Category" | "Rewards" | "Me";

const text = (x: number, y: number, value: string, size: number, color = "#101828", weight = 400, anchor = "start") =>
  `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${color}" text-anchor="${anchor}">${value}</text>`;

const rect = (x: number, y: number, w: number, h: number, fill: string, radius = 0) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}" fill="${fill}"/>`;

function statusBar(): string {
  return [rect(0, 0, width, 44, "#FFFFFF"), text(24, 29, "9:41", 15, "#101828", 600), rect(300, 18, 22, 11, "#101828", 3), rect(284, 20, 12, 8, "#101828", 2)].join("");
}

function header(title: string, back: boolean): string {
  const backArrow = back ? `<path d="M30 62 l-10 10 l10 10" stroke="#101828" stroke-width="2.5" fill="none" stroke-linecap="round"/>` : "";
  const titleX = back ? 44 : 20;
  return [
    rect(0, 44, width, 56, "#FFFFFF"),
    backArrow,
    text(titleX, 80, title, back ? 18 : 21, back ? "#101828" : brand, 700),
    `<circle cx="326" cy="72" r="13" fill="none" stroke="#344054" stroke-width="2"/>`,
    `<circle cx="292" cy="72" r="9" fill="none" stroke="#344054" stroke-width="2"/>`,
  ].join("");
}

const tabs: { name: Tab; x: number }[] = [
  { name: "Home", x: 45 },
  { name: "Category", x: 135 },
  { name: "Rewards", x: 225 },
  { name: "Me", x: 315 },
];

function tabBar(active: Tab): string {
  const items = tabs.map(({ name, x }) => {
    const color = name === active ? brand : "#98A2B3";
    return `<rect x="${x - 10}" y="${tabBarTop + 14}" width="20" height="18" rx="5" fill="${color}"/>${text(x, tabBarTop + 50, name, 11, color, name === active ? 700 : 500, "middle")}`;
  });
  return [rect(0, tabBarTop, width, height - tabBarTop, "#FFFFFF"), rect(0, tabBarTop, width, 1, "#EAECF0"), ...items].join("");
}

const products = [
  { name: "Air Runner 3", price: "$89.00", color: "#FDE68A" },
  { name: "Daily Backpack", price: "$45.00", color: "#BFDBFE" },
  { name: "Ceramic Mug", price: "$12.00", color: "#FBCFE8" },
  { name: "Wireless Headphones", price: "$129.00", color: "#C7D2FE" },
];

function productGrid(top: number, brokenPrice: boolean): string {
  return products
    .map((item, index) => {
      const x = index % 2 === 0 ? 20 : 186;
      const y = top + Math.floor(index / 2) * 168;
      const price = brokenPrice && index === 1 ? "$NaN" : item.price;
      const priceColor = brokenPrice && index === 1 ? "#D92D20" : "#101828";
      return [rect(x, y, 154, 104, item.color, 14), text(x + 2, y + 126, item.name, 13, "#475467", 500), text(x + 2, y + 148, price, 15, priceColor, 700)].join("");
    })
    .join("");
}

function homeBody(broken: boolean): string {
  const banner = broken
    ? [rect(20, 160, 320, 132, "#F2F4F7", 18), text(180, 222, "Couldn't load the image", 14, "#98A2B3", 500, "middle"), text(180, 246, "Try again", 13, "#667085", 600, "middle")].join("")
    : [
        `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6366F1"/><stop offset="1" stop-color="#4338CA"/></linearGradient></defs>`,
        `<rect x="20" y="160" width="320" height="132" rx="18" fill="url(#g)"/>`,
        text(40, 194, "Today's deals", 14, "#E0E7FF", 600),
        text(40, 232, "Up to 30% off", 26, "#FFFFFF", 800),
        text(40, 264, "November only · Free shipping", 13, "#C7D2FE", 500),
        `<circle cx="292" cy="236" r="34" fill="#818CF8"/>`,
      ].join("");
  const chips = ["New", "Best", "Sale", "Coupons"]
    .map((label, index) => {
      const x = 52 + index * 85;
      return `<circle cx="${x}" cy="330" r="24" fill="#EEF2FF"/>${text(x, 374, label, 12, "#344054", 500, "middle")}`;
    })
    .join("");
  return [
    rect(20, 108, 320, 40, "#F2F4F7", 20),
    text(44, 133, "Search products", 14, "#98A2B3"),
    banner,
    chips,
    text(20, 418, "Recommended", 17, "#101828", 700),
    productGrid(434, broken),
  ].join("");
}

function categoryBody(): string {
  const rows = ["Fashion", "Beauty", "Food", "Living", "Digital", "Sports", "Books"];
  return rows
    .map((label, index) => {
      const y = 112 + index * 74;
      const color = ["#FDE68A", "#FBCFE8", "#BBF7D0", "#BFDBFE", "#C7D2FE", "#FED7AA", "#E9D5FF"][index];
      return [
        rect(20, y, 48, 48, color, 12),
        text(84, y + 30, label, 16, "#101828", 600),
        `<path d="M330 ${y + 17} l7 7 l-7 7" stroke="#98A2B3" stroke-width="2" fill="none"/>`,
        rect(20, y + 62, 320, 1, "#F2F4F7"),
      ].join("");
    })
    .join("");
}

function attendanceBody(error: boolean): string {
  const stamps: string[] = [];
  for (let index = 0; index < 28; index += 1) {
    const x = 50 + (index % 7) * 43;
    const y = 252 + Math.floor(index / 7) * 50;
    const done = index < 7;
    stamps.push(`<circle cx="${x}" cy="${y}" r="17" fill="${done ? brand : "#F2F4F7"}"/>`);
    stamps.push(text(x, y + 5, done ? "✓" : String(index + 1), 13, done ? "#FFFFFF" : "#98A2B3", 600, "middle"));
  }
  const toast = error
    ? [rect(30, 560, 300, 52, "#101828", 14), text(180, 591, "Something went wrong. Try again.", 14, "#FFFFFF", 500, "middle")].join("")
    : "";
  return [
    rect(20, 112, 320, 96, "#EEF2FF", 18),
    text(40, 148, "November · Day 7", 20, "#101828", 700),
    text(40, 178, "Earn 10P every day you check in", 14, "#4338CA", 500),
    ...stamps,
    rect(20, 470, 320, 54, brand, 14),
    text(180, 503, "Check in today", 16, "#FFFFFF", 700, "middle"),
    toast,
  ].join("");
}

function myBody(): string {
  const rows = [
    ["Order history", "3"],
    ["My coupons", "2"],
    ["Points", "1,200P"],
    ["Addresses", ""],
    ["Help center", ""],
    ["Settings", ""],
  ];
  return [
    `<circle cx="56" cy="148" r="32" fill="#E0E7FF"/>`,
    text(104, 142, "Sample Customer", 18, "#101828", 700),
    text(104, 166, "Standard member", 13, "#667085", 500),
    ...rows.map(([label, value], index) => {
      const y = 214 + index * 62;
      return [text(24, y + 26, label, 16, "#101828", 500), text(336, y + 26, value, 15, brand, 600, "end"), rect(20, y + 48, 320, 1, "#F2F4F7")].join("");
    }),
  ].join("");
}

function cartBody(): string {
  const items = [
    ["Air Runner 3", "$89.00"],
    ["Ceramic Mug", "$12.00"],
  ];
  return [
    ...items.map(([name, price], index) => {
      const y = 116 + index * 112;
      return [rect(20, y, 84, 84, index === 0 ? "#FDE68A" : "#FBCFE8", 12), text(120, y + 34, name, 15, "#101828", 600), text(120, y + 62, price, 16, "#101828", 700)].join("");
    }),
    rect(20, 360, 320, 1, "#EAECF0"),
    text(24, 400, "Total", 17, "#101828", 700),
    text(336, 400, "$101.00", 19, brand, 800, "end"),
    rect(20, 600, 320, 54, brand, 14),
    text(180, 633, "Place order", 16, "#FFFFFF", 700, "middle"),
  ].join("");
}

interface ScreenSpec {
  title: string;
  back: boolean;
  tab: Tab;
  body: () => string;
}

const specs: Record<ScreenId, ScreenSpec> = {
  home: { title: "Sample Shop", back: false, tab: "Home", body: () => homeBody(false) },
  homeBroken: { title: "Sample Shop", back: false, tab: "Home", body: () => homeBody(true) },
  category: { title: "Category", back: false, tab: "Category", body: categoryBody },
  attendance: { title: "Check-in", back: true, tab: "Rewards", body: () => attendanceBody(false) },
  attendanceError: { title: "Check-in", back: true, tab: "Rewards", body: () => attendanceBody(true) },
  my: { title: "Me", back: false, tab: "Me", body: myBody },
  cart: { title: "Cart", back: true, tab: "Home", body: cartBody },
};

function svgOf(id: ScreenId): string {
  const spec = specs[id];
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${font}">`,
    rect(0, 0, width, height, "#FFFFFF"),
    spec.body(),
    statusBar(),
    header(spec.title, spec.back),
    tabBar(spec.tab),
    "</svg>",
  ].join("");
}

const toDataUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

export function screenUrl(id: ScreenId): string {
  return toDataUrl(svgOf(id));
}

/** 차이 이미지: 기준 화면을 흐리게 깔고 달라진 곳(배너·가격)을 빨갛게 칠한다 */
export function homeDiffUrl(): string {
  const base = svgOf("home").replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "");
  return toDataUrl(
    [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${font}">`,
      `<g opacity="0.22">${base}</g>`,
      `<rect x="20" y="160" width="320" height="132" rx="18" fill="#F04438" fill-opacity="0.55"/>`,
      `<rect x="186" y="566" width="110" height="24" rx="4" fill="#F04438" fill-opacity="0.75"/>`,
      "</svg>",
    ].join(""),
  );
}

/** 데모 전용 안내: 상단 배지 하나와, 바꾸는 버튼을 눌렀을 때 뜨는 토스트. 실제 화면 코드는 건드리지 않는다. */
const toastMs = 2_400;
const style = `
.demo-ribbon{position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:1000;display:flex;gap:8px;align-items:center;
  padding:8px 14px;border-radius:999px;background:#101828;color:#fff;font:500 13px/1.3 system-ui,sans-serif;box-shadow:0 6px 20px rgba(16,24,40,.25)}
.demo-ribbon a{color:#A5B4FC;text-decoration:none}
.demo-toast{position:fixed;left:50%;top:20px;transform:translate(-50%,-8px);z-index:1001;padding:10px 16px;border-radius:12px;
  background:#B42318;color:#fff;font:600 14px/1.3 system-ui,sans-serif;opacity:0;transition:opacity .2s,transform .2s;pointer-events:none}
.demo-toast[data-show="true"]{opacity:1;transform:translate(-50%,0)}
`;

let toast: HTMLDivElement | null = null;
let timer: number | undefined;

function mount(): HTMLDivElement {
  if (toast) return toast;
  const sheet = document.createElement("style");
  sheet.textContent = style;
  document.head.append(sheet);

  const ribbon = document.createElement("div");
  ribbon.className = "demo-ribbon";
  ribbon.innerHTML = `Demo mode · fictional "Sample Shop" data · <a href="https://github.com/Ahnseungc/device-farm" target="_blank" rel="noreferrer">GitHub</a>`;
  document.body.append(ribbon);

  toast = document.createElement("div");
  toast.className = "demo-toast";
  toast.setAttribute("role", "status");
  document.body.append(toast);
  return toast;
}

export function showDemoToast(message: string): void {
  const element = mount();
  element.textContent = message;
  element.dataset.show = "true";
  window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    element.dataset.show = "false";
  }, toastMs);
}

export function mountDemoRibbon(): void {
  if (typeof document !== "undefined") mount();
}

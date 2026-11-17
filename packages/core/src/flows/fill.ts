/**
 * 입력 스텝: aria-label(없으면 placeholder)로 입력칸을 찾아 값을 넣는다. 드라이버마다 따로 만들지 않고 evaluate 한 번으로 한다.
 * React가 제어하는 입력칸은 value를 그냥 바꾸면 상태가 안 바뀌어, 원래 setter로 넣고 input·change 이벤트를 보낸다.
 */
export function fillScript(label: string, value: string): string {
  return `(() => {
  const label = ${JSON.stringify(label)};
  const value = ${JSON.stringify(value)};
  const fields = [...document.querySelectorAll("input, textarea")];
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const field = fields.find((el) => el.getAttribute("aria-label") === label && visible(el)) ?? fields.find((el) => el.getAttribute("placeholder") === label && visible(el));
  if (!field) return false;
  field.focus();
  const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
  field.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
})()`;
}

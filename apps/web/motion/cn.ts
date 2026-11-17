/** 클래스 이름 이어 붙이기. 디바이스팜은 Tailwind가 없어 tailwind-merge 없이 이어 붙이기만 한다 */
export function cn(...inputs: (string | false | null | undefined)[]): string {
  return inputs.filter(Boolean).join(" ");
}

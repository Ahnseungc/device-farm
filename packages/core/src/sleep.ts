/** 런타임에 상관없이 쓰는 대기. core는 node 모듈을 쓰지 않는다. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

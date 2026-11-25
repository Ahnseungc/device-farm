/**
 * 지금 연결(context)에 건 것(쓰기 가드·로그 수집)을 다시 붙을 때 새 연결에도 건다.
 * 예전에는 옛 연결과 함께 사라졌다. 버튼을 누르다 502로 앱을 다시 켜면 남은 버튼이 쓰기 차단 없이 눌렸다.
 */
export type Detach = () => Promise<void>;
type Hook<C> = { attach: (context: C) => Promise<Detach>; detach: Detach };

export interface ContextHooks<C> {
  /** 지금 연결에 걸고, 다시 붙을 때마다 새 연결에도 건다. 돌려준 함수로 푼다 */
  attach(attach: (context: C) => Promise<Detach>): Promise<Detach>;
  /** 새 연결에 전부 다시 건다. 하나라도 못 걸면 throw — 부른 쪽은 새 연결을 쓰지 않는다(fail closed) */
  reattach(next: C): Promise<void>;
}

export function createContextHooks<C>(current: () => C): ContextHooks<C> {
  const hooks = new Set<Hook<C>>();
  return {
    attach: async (attach) => {
      const hook: Hook<C> = { attach, detach: await attach(current()) };
      hooks.add(hook);
      return async () => {
        if (hooks.delete(hook)) await hook.detach();
      };
    },
    reattach: async (next) => {
      const replaced: { hook: Hook<C>; detach: Detach }[] = [];
      for (const hook of hooks) replaced.push({ hook, detach: await hook.attach(next) });
      for (const { hook, detach } of replaced) hook.detach = detach;
    },
  };
}

/**
 * 슬랙 Web API(봇 토큰). 디바이스팜 서버만 쓴다 — 토큰은 .env `SLACK_BOT_TOKEN`.
 * 슬랙이 실패해도 점검 결과는 그대로다. 호출하는 쪽이 오류를 기록만 한다.
 */

export type SlackFetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ json(): Promise<unknown> }>;

export class SlackError extends Error {}

type SlackResponse = { ok: boolean; error?: string; ts?: string; channel?: string; url?: string };

export interface SlackClient {
  post: (channel: string, text: string, blocks: unknown[]) => Promise<{ channel: string; ts: string }>;
  update: (channel: string, ts: string, text: string, blocks: unknown[]) => Promise<void>;
  /** 메시지 스레드에 글 한 줄 */
  reply: (channel: string, threadTs: string, text: string) => Promise<void>;
  /** 이미지 한 장을 메시지 스레드에 올린다(`files:write`). 새 업로드 API 3단계 */
  uploadImage: (channel: string, threadTs: string, file: Buffer, filename: string, title: string) => Promise<void>;
  /** 메시지 스레드에 블록(버튼) 글. 나중에 고치려고 ts를 돌려준다 */
  postInThread: (channel: string, threadTs: string, text: string, blocks: unknown[]) => Promise<{ channel: string; ts: string }>;
  /** 스레드 원글과 댓글(오래된 것부터, `channels:history`). 슬랙 메시지 그대로 */
  threadMessages?: (channel: string, threadTs: string) => Promise<Record<string, unknown>[]>;
  /** 이름(실명·표시 이름)이 같은 사람의 슬랙 id. `users:read` 권한이 없거나 못 찾으면 null */
  findUserIdByName: (name: string) => Promise<string | null>;
}

type SlackMember = { id: string; deleted?: boolean; is_bot?: boolean; real_name?: string; profile?: { real_name?: string; display_name?: string } };
const normalizeName = (name: string) => name.replace(/\s+/g, "");

/** 업로드 주소로 파일 본문을 보낸다(JSON이 아니라 바이트) */
export type UploadFetch = (url: string, init: { method: string; headers: Record<string, string>; body: Buffer }) => Promise<{ ok: boolean; status: number }>;

export function createSlackClient(
  token: string,
  fetchImpl: SlackFetch = (url, init) => fetch(url, init),
  uploadFetch: UploadFetch = (url, init) => fetch(url, { ...init, body: new Uint8Array(init.body) }),
): SlackClient {
  /** 사용자 목록은 한 번만 받는다 */
  let members: Promise<SlackMember[]> | null = null;
  // 읽기 메서드(users.list)는 JSON 본문을 안 받아 폼으로 보낸다
  const formMethods = new Set(["users.list", "files.getUploadURLExternal", "conversations.replies"]);
  const call = async (method: string, body: Record<string, unknown>): Promise<SlackResponse> => {
    const form = formMethods.has(method);
    const response = await fetchImpl(`https://slack.com/api/${method}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": form ? "application/x-www-form-urlencoded" : "application/json; charset=utf-8" },
      body: form ? new URLSearchParams(Object.entries(body).map(([key, value]) => [key, String(value)])).toString() : JSON.stringify(body),
    });
    const data = (await response.json()) as SlackResponse;
    if (!data.ok) throw new SlackError(`슬랙 ${method} 실패: ${data.error ?? "알 수 없음"}`);
    return data;
  };
  return {
    post: async (channel, text, blocks) => {
      const data = await call("chat.postMessage", { channel, text, blocks, unfurl_links: false });
      return { channel: data.channel ?? channel, ts: data.ts ?? "" };
    },
    update: async (channel, ts, text, blocks) => {
      await call("chat.update", { channel, ts, text, blocks });
    },
    reply: async (channel, threadTs, text) => {
      await call("chat.postMessage", { channel, thread_ts: threadTs, text, unfurl_links: false });
    },
    uploadImage: async (channel, threadTs, file, filename, title) => {
      const target = (await call("files.getUploadURLExternal", { filename, length: file.length })) as SlackResponse & { upload_url?: string; file_id?: string };
      if (!target.upload_url || !target.file_id) throw new SlackError("슬랙 files.getUploadURLExternal 실패: 주소 없음");
      const uploaded = await uploadFetch(target.upload_url, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: file });
      if (!uploaded.ok) throw new SlackError(`슬랙 파일 올리기 실패: ${uploaded.status}`);
      await call("files.completeUploadExternal", { files: [{ id: target.file_id, title }], channel_id: channel, thread_ts: threadTs });
    },
    postInThread: async (channel, threadTs, text, blocks) => {
      const data = await call("chat.postMessage", { channel, thread_ts: threadTs, text, blocks, unfurl_links: false });
      return { channel: data.channel ?? channel, ts: data.ts ?? "" };
    },
    threadMessages: async (channel, threadTs) => {
      const data = (await call("conversations.replies", { channel, ts: threadTs, limit: 100 })) as SlackResponse & { messages?: Record<string, unknown>[] };
      return data.messages ?? [];
    },
    findUserIdByName: async (name) => {
      members ??= (async () => {
        const all: SlackMember[] = [];
        let cursor = "";
        do {
          const data = (await call("users.list", { limit: 200, ...(cursor ? { cursor } : {}) })) as SlackResponse & { members?: SlackMember[]; response_metadata?: { next_cursor?: string } };
          all.push(...(data.members ?? []));
          cursor = data.response_metadata?.next_cursor ?? "";
        } while (cursor);
        return all.filter((member) => !member.deleted && !member.is_bot);
      })();
      try {
        const target = normalizeName(name);
        const found = (await members).filter((member) => [member.real_name, member.profile?.real_name, member.profile?.display_name].some((value) => value && normalizeName(value) === target));
        // 동명이인이면 잘못 태그하지 않게 이름만 쓴다
        return found.length === 1 ? found[0].id : null;
      } catch {
        // users:read 권한이 없으면 목록을 못 받는다 — 이름만 쓴다
        members = null;
        return null;
      }
    },
  };
}

/** Socket Mode 연결 주소. 앱 레벨 토큰(`xapp-`, connections:write)으로 받는다 */
export async function openSocketUrl(appToken: string, fetchImpl: SlackFetch = (url, init) => fetch(url, init)): Promise<string> {
  const response = await fetchImpl("https://slack.com/api/apps.connections.open", {
    method: "POST",
    headers: { Authorization: `Bearer ${appToken}`, "Content-Type": "application/x-www-form-urlencoded" },
  });
  const data = (await response.json()) as SlackResponse;
  if (!data.ok || !data.url) throw new SlackError(`슬랙 Socket Mode 연결 실패: ${data.error ?? "주소 없음"}`);
  return data.url;
}

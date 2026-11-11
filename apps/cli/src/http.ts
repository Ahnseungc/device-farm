export class CliError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isConnectionRefused(error: unknown): boolean {
  return error instanceof TypeError && isRecord(error.cause) && error.cause.code === "ECONNREFUSED";
}

/** 디바이스팜 서버 JSON을 읽는다. `{ error }`나 2xx가 아니면 서버 문구로 CliError. */
export async function requestJson(port: number, path: string, init?: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`http://127.0.0.1:${port}${path}`, init);
  } catch (error) {
    if (isConnectionRefused(error)) throw new CliError(`디바이스팜 서버(127.0.0.1:${port})에 연결할 수 없습니다.`);
    throw error;
  }
  const body: unknown = await response.json().catch(() => null);
  if (isRecord(body) && typeof body.error === "string") throw new CliError(body.error);
  if (!response.ok) throw new CliError(`디바이스팜 서버 응답 오류: ${response.status} ${path}`);
  return body;
}

export { isRecord };

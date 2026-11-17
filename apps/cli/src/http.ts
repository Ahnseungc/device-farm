import { farmLocalOrigin } from "@device-farm/server/env";

export class CliError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function causeCode(error: unknown): unknown {
  return error instanceof TypeError && isRecord(error.cause) ? error.cause.code : undefined;
}

/** 직접 만든(mkcert 등) 인증서를 Node가 모를 때 나는 오류 */
const untrustedCertCodes = new Set(["SELF_SIGNED_CERT_IN_CHAIN", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "DEPTH_ZERO_SELF_SIGNED_CERT", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY"]);
export const untrustedCertMessage = "디바이스팜 서버 인증서를 믿지 못했습니다. 셸에 NODE_EXTRA_CA_CERTS=\"$(mkcert -CAROOT)/rootCA.pem\"을 두세요.";

/** 디바이스팜 서버 JSON을 읽는다. `{ error }`나 2xx가 아니면 서버 문구로 CliError. */
export async function requestJson(port: number, path: string, init?: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${farmLocalOrigin(port)}${path}`, init);
  } catch (error) {
    const code = causeCode(error);
    if (code === "ECONNREFUSED") throw new CliError(`디바이스팜 서버(127.0.0.1:${port})에 연결할 수 없습니다.`);
    if (typeof code === "string" && untrustedCertCodes.has(code)) throw new CliError(untrustedCertMessage);
    throw error;
  }
  const body: unknown = await response.json().catch(() => null);
  if (isRecord(body) && typeof body.error === "string") throw new CliError(body.error);
  if (!response.ok) throw new CliError(`디바이스팜 서버 응답 오류: ${response.status} ${path}`);
  return body;
}

export { isRecord };

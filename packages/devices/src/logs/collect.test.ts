import assert from "node:assert/strict";

import { parseNetworkLog } from "@device-farm/core/logs/network";

import {
  consoleToEntry,
  logcatLineToEntry,
  requestFailedToEntry,
  responseToEntry,
  safariConsoleToEntry,
  safariNetworkToEntry,
  safeUrl,
  syslogLineToEntry,
} from "./collect";

// logcat
assert.equal(logcatLineToEntry("   "), null);
assert.deepEqual(logcatLineToEntry("10-23 12:00:00.000  1234  1234 I flutter: hello"), {
  source: "system",
  text: "10-23 12:00:00.000  1234  1234 I flutter: hello",
});
assert.equal(logcatLineToEntry("E AndroidRuntime: FATAL EXCEPTION: main")?.source, "crash");

// idevicesyslog
assert.equal(syslogLineToEntry(""), null);
assert.equal(syslogLineToEntry("Oct 23 Runner[123] <Notice>: ok")?.source, "system");
assert.equal(syslogLineToEntry("Runner[1]: *** Terminating app due to uncaught exception 'X'")?.source, "crash");

// Playwright console·network
assert.equal(consoleToEntry("warning", "w"), null);
assert.deepEqual(consoleToEntry("error", "boom"), { source: "console", text: "boom" });
assert.equal(responseToEntry(200, "GET", "https://a.com/x"), null);
assert.deepEqual(responseToEntry(500, "POST", "https://a.com/api/x?token=secret#h"), {
  source: "network",
  text: "POST 500 https://a.com/api/x",
});
assert.equal(requestFailedToEntry("GET", "https://a.com/y?q=1", "net::ERR_FAILED").text, "GET 0 https://a.com/y net::ERR_FAILED");
assert.equal(safeUrl("not a url?token=1"), "not a url");

// safariConsole: error만, message JSON의 text만
const consoleEntry = (message: unknown, level = "SEVERE") => ({ level, timestamp: 1, message: JSON.stringify(message) });
assert.deepEqual(safariConsoleToEntry(consoleEntry({ level: "error", text: "TypeError: x", stack: "..." })), {
  source: "console",
  text: "TypeError: x",
});
assert.equal(safariConsoleToEntry(consoleEntry({ level: "log", text: "hi" }, "INFO")), null);
assert.equal(safariConsoleToEntry({ message: "not json" }), null);
assert.equal(safariConsoleToEntry(null), null);

// safariNetwork: 상태 ≥ 400, 실패만. 본문·헤더는 남지 않는다.
const networkEntry = (message: unknown) => ({ level: "INFO", timestamp: 1, message: JSON.stringify(message) });
const failedResponse = safariNetworkToEntry(
  networkEntry({
    method: "Network.responseReceived",
    params: { response: { url: "https://a.com/api?x=1", status: 404, headers: { Authorization: "Bearer zzz" } } },
  }),
);
assert.deepEqual(failedResponse, { source: "network", text: "UNKNOWN 404 https://a.com/api" });
assert.equal(
  safariNetworkToEntry(networkEntry({ method: "Network.responseReceived", params: { response: { url: "https://a.com", status: 200 } } })),
  null,
);
assert.equal(
  safariNetworkToEntry(networkEntry({ method: "Network.loadingFailed", params: { errorText: "cancelled" } }))?.text,
  "UNKNOWN 0 - cancelled",
);
assert.equal(safariNetworkToEntry(networkEntry({ method: "Network.dataReceived", params: { body: "secret" } })), null);

// 수집기가 쓴 줄을 탐색 probe가 그대로 읽어야 한다.
assert.deepEqual(parseNetworkLog(responseToEntry(500, "POST", "https://a.com/api/x?token=1")?.text ?? ""), {
  method: "POST",
  status: 500,
  url: "https://a.com/api/x",
});
assert.equal(parseNetworkLog(requestFailedToEntry("GET", "https://a.com/y", "net::ERR_FAILED").text)?.status, 0);

console.log("collect ok");

import assert from "node:assert/strict";

import { plainError } from "./plain-error";

// 실제로 슬랙에 나갔던 원문(2026-11 기록)
assert.equal(
  plainError('Unable to connect to "http://127.0.0.1:4723/", make sure browser driver is running on that address.\nIt seems like the service failed to start or is rejecting any connections.'),
  "기기를 조종하는 프로그램(Appium)이 꺼져 있어 점검을 못 했어요. 디바이스팜 맥에서 Appium이 켜져 있는지 확인해 주세요.",
);
assert.match(plainError("adb: failed to install /Users/x/test-results/builds/a.apk: Failure [INSTALL_FAILED_VERSION_DOWNGRADE: Downgrade detected]"), /더 새 버전의 앱이 깔려 있어서/);
assert.match(plainError("ENOENT: no such file or directory, open '/Users/me/.config/device-farm/firebase-dev.json'"), /Firebase 접속 정보 파일\(firebase-dev\.json\)/);
assert.match(plainError("The caller does not have permission"), /Firebase에서 권한이 없다고/);

// 기기 연결
assert.match(plainError("error: device 'RF9R3044X9Z' not found"), /기기가 디바이스팜 맥에 연결되어 있지 않아요/);
assert.match(plainError("adb: device offline"), /연결되어 있지 않아요/);
assert.match(plainError("adb: device unauthorized."), /USB 디버깅 허용/);

// GitHub·git·Claude
assert.match(plainError("GitHub GET /user 401: Bad credentials"), /토큰이 맞지 않거나 만료/);
assert.match(plainError("GitHub POST /repos/x/pulls 403: Resource not accessible by personal access token"), /권한이 없어요/);
assert.match(plainError("git push 실패: ! [rejected] HEAD -> main (fetch first)"), /먼저 올라간 커밋/);
assert.match(plainError("Invalid API key · Please run /login"), /Claude 로그인이 풀렸어요/);

// 이미 한국어면 그대로
assert.equal(plainError("#단계 홈에서 시작 「홈」 실패: \"홈\" 링크를 찾지 못했습니다."), "#단계 홈에서 시작 「홈」 실패: \"홈\" 링크를 찾지 못했습니다.");
assert.equal(plainError("Claude가 15분 안에 끝나지 않았어요."), "Claude가 15분 안에 끝나지 않았어요.");

// 모르는 영어는 감싸고 원문 앞부분만(경로는 파일 이름만)
assert.equal(plainError("TypeError: Cannot read properties of undefined (reading 'x') at /Users/me/device-farm/a/b.ts:1"), "디바이스팜이 처음 보는 오류가 났어요. 결과 탭의 로그를 확인해 주세요. (원문: TypeError: Cannot read properties of undefined (reading 'x') at b.ts:1)");
assert.equal(plainError(""), "");
assert.equal(plainError(undefined), "");

console.log("plain error ok");

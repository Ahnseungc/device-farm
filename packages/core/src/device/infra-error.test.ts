import assert from "node:assert/strict";

import { blockedByFarmMessage, devChipBlocked, hiddenPagePrefix, isFlowTimeout, isHarmlessBlocked, isInfraFailure } from "./infra-error";

assert.equal(isInfraFailure("Android 앱에서 웹 화면을 찾지 못했습니다. 로그아웃돼 네이티브 로그인 화면일 수 있습니다."), true);
assert.equal(isInfraFailure("WebDriverError: A session is either terminated or not started"), true);
assert.equal(isInfraFailure("1단계 홈에서 시작 「홈」 실패: 화면에서 WebView 위치를 찾지 못했습니다"), true);
assert.equal(isInfraFailure("12단계 문구 확인 「입금처 정보」 실패: \"입금처 정보\" 문구 대신 웹 서버 오류 화면(502 Bad Gateway)이 보였습니다. 300초 동안 다시 불러와도 같았습니다(서버 배포 중일 수 있음)."), true);
assert.equal(isInfraFailure("플로우가 10분 안에 끝나지 않아 3단계 누르기 「확인」에서 멈추고 다음으로 넘어갔습니다."), true);
assert.equal(isInfraFailure("1단계 홈에서 시작 「홈」 실패: 하단 「홈」 탭을 찾지 못했습니다"), false);
assert.equal(isInfraFailure("기준 화면과 다릅니다."), false);
assert.equal(isInfraFailure("/cs/inquiry 화면이 15초 안에 그려지지 않았습니다."), false);
assert.equal(isInfraFailure(undefined), false);
assert.equal(isFlowTimeout("플로우가 10분 안에 끝나지 않아 멈추고 다음으로 넘어갔습니다."), true);
assert.equal(isFlowTimeout("WebDriverError: A session is either terminated"), false);

assert.equal(isInfraFailure(blockedByFarmMessage("POST /v1/api/v1/ad-reward/nonce", "3단계 실패")), true);
const harmless = [/\/impression$/, /^\/api\/log\//];
for (const path of ["https://ads.example.net/banner", "/v1/ads/898/impression", "/api/log/stack-nav"]) assert.equal(isHarmlessBlocked(path, harmless), true, path);
for (const path of ["/v1/ad-reward/nonce", "/v1/quiz/332/answer"]) assert.equal(isHarmlessBlocked(path, harmless), false, path);
// 앱 서버 경로는 앱이 적은 것만 무관하다
assert.equal(isHarmlessBlocked("/api/log/stack-nav", []), false);

// 점검기가 숨은 웹 화면을 읽었거나 개발용 칩이 덮은 실패는 점검 못 함. 보통의 「가려져 있습니다」는 앱 실패 그대로다
assert.equal(isInfraFailure(`3단계 누르기 「예상 견적」 실패: ${hiddenPagePrefix}"예상 견적" 버튼이 다른 요소(div.flex)에 가려져 있습니다. 누르지 않았습니다.`), true);
assert.equal(isInfraFailure(`"홈" 링크가 ${devChipBlocked}. 누르지 않았습니다.`), true);
assert.equal(isInfraFailure('"예상 견적" 버튼이 다른 요소(div.flex)에 가려져 있습니다. 누르지 않았습니다.'), false);

console.log("infra error ok");

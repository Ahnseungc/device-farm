# 설계: 탐색 점검과 쓰기 요청 가드

## 목표

정해진 시나리오 밖에서 깨지는 화면을 찾는다. 홈부터 누를 수 있는 것을 차례로 눌러 보며, 화면마다 오류를 본다. 실계정·실데이터라서 **되돌릴 수 없는 요청은 한 건도 서버에 보내지 않는 것**이 먼저다.

## 범위

- Android dev 빌드만. iOS는 WebView 요청을 가로챌 수 없어 Android에서 차단 없이 끝난 경로만 다시 돌며 화면을 본다.
- 운영 빌드는 탐색하지 않는다.

## 탐색

- 너비 우선, 깊이 6, 화면당 동작 20개, 30분 상한.
- 화면 구분: 경로 + 누를 수 있는 동작 목록의 해시. 같은 화면은 한 번만 펼친다.
- 동작: 버튼·링크 누르기, 입력칸 채우기(`explore/form-values.json`에 라벨이 있는 칸만). 금지어 버튼은 뺀다.
- 경로마다 홈에서 다시 재생한다. 재생이 어긋나면 그 경로는 「재생 실패」로 남기고 결함으로 보지 않는다.

## 오류 판정(probe)

| 종류 | 근거 |
| --- | --- |
| app-error | `appErrorText`가 보인다 |
| login-redirect | `loginPaths`로 이동 |
| crash | logcat `FATAL EXCEPTION` 등 |
| console | 콘솔 오류 |
| network | 4xx·5xx(허용한 쓰기의 400·409·422는 정상으로 본다) |
| layout | 가로 넘침·화면 밖·하단 고정 영역에 가림 |

오류가 난 화면마다 스크린샷·로그·영상 묶음을 남긴다.

## 쓰기 요청 가드

WebView 컨텍스트의 모든 요청을 가로채 판단한다.

1. GET·HEAD·OPTIONS는 통과.
2. `guard.pushTokenRequests`(앱이 켜질 때마다 하는 요청)는 통과.
3. 금지 경로(`defaultForbiddenApiPatterns` + `guard.extraForbiddenApiPatterns`)면 차단. 허용 목록에 allow로 있어도 막는다. 원문과 URL 디코딩 둘 다 본다.
4. 허용 목록(`explore/allowlist.json`)에 allow면 통과, deny면 차단.
5. 목록에 없으면 차단(fail closed).

내부(웹·`apiOrigin`) 요청은 경로로, 외부 요청은 `https://host/path` 전체로 판단한다. 외부 쓰기를 열려면 전체 주소로 allow를 적는다. 주소를 못 읽으면 쓰기는 막는다.

허용 목록은 사람이 고친다. `npm run explore-allowlist`는 OpenAPI 스펙의 쓰기 API를 deny로만 덧붙인다(allow는 사람이 고른다).

가드가 막은 요청 때문에 생긴 콘솔·네트워크 오류는 앱 결함으로 세지 않는다.

# device-farm

[![npm](https://img.shields.io/npm/v/@ahnseungchan/device-farm)](https://www.npmjs.com/package/@ahnseungchan/device-farm)
[![license](https://img.shields.io/badge/license-MIT-blue)](https://github.com/Ahnseungc/device-farm/blob/main/LICENSE)
[![node](https://img.shields.io/node/v/@ahnseungchan/device-farm)](https://nodejs.org/)

**WebView로 만든 모바일 앱을 실기기에서 QA 자동화하는 디바이스팜. 내 프로젝트에 설치하고 `farm.config.ts` 하나로 점검할 앱을 정한다.**

Android는 adb + Chrome DevTools Protocol(Playwright), iOS는 Appium(XCUITest·WebDriverAgent)으로 앱 안 WebView를 직접 조작합니다. 기준 화면 비교, 버튼 눌러보기·화면 지도, 플로우 녹화, 카오스 탐색, 정책·피그마 대조를 웹 화면과 CLI로 돌리고, Claude Code가 MCP 도구로 기기를 탐색할 수 있습니다.

## Why

| 손으로 하는 QA | device-farm |
| --- | --- |
| 새 빌드가 나오면 기기마다 깔고 화면을 하나씩 열어 본다 | Firebase App Distribution·TestFlight 새 빌드를 받아 연결된 기기 전부에 깔고, 고정 주소 화면을 딥링크로 열어 기준 화면과 픽셀 비교 |
| 버튼을 다 눌러 봤는지 기억에 의존한다 | 화면의 버튼을 하나씩 눌러 반응(이동·팝업·반응 없음·오류)을 남기고, 결과가 **화면 지도**가 된다 |
| 시나리오 테스트를 코드로 짜고 고친다 | 사람이 기기를 움직이면 녹화해 플로우 후보로 올리고, 확정한 것만 돈다 |
| 뒤로·연타·백그라운드 같은 엣지 케이스는 운에 맡긴다 | 시드 고정 카오스 탐색으로 재현 가능한 무작위 조작 |
| 정책 문서·피그마 문구와 화면이 맞는지 눈으로 대조한다 | Confluence 정책·피그마 문구를 화면 글자와 맞춰 본다 |
| 탐색 자동화가 실제 결제·탈퇴를 누를까 무섭다 | 쓰기 요청 가드(허용 목록 밖 POST/PUT/PATCH/DELETE 차단)와 금지 버튼 목록. 가드를 못 걸면 시작하지 않는다 |

점검할 앱은 코드에 없습니다. 패키지 id·웹 주소·하단 탭·금지어·시나리오처럼 앱마다 다른 값은 전부 `farm.config.ts`로 **주입**합니다.

## Features

- **빌드 점검**: 새 빌드 감시 → 설치 → 고정 주소 화면 점검. 앱 오류 문구·로그인 튕김·빈 화면·기준 화면 픽셀 비교로 판정
- **버튼 눌러보기·화면 지도**: 버튼별 반응을 기록하고, 화면 간 이동을 지도로 쌓는다. 지도 블록을 이어 붙여 플로우를 만든다
- **플로우**: 홈에서 버튼·링크만 눌러 가는 시나리오. 녹화, 화면 지도 조립, PRD로 LLM 후보 생성(선택)
- **데이터 QA**: 화면이 부르는 GET API를 다시 불러 합계·표시 값을 규칙으로 맞춰 본다(LLM 없음)
- **탐색·카오스 탐색**: 너비 우선 탐색과 시드 고정 카오스(뒤로·연타·로딩 중 뒤로·백그라운드·재시작)
- **정책·피그마 대조**: Confluence 정책 바뀜 감지, 규칙 뽑기, 피그마 문구 대조
- **원격 조작**: 웹 화면에서 기기 화면을 보며(Android H.264, iOS MJPEG) 직접 누른다. 조작 중인 기기는 잠근다
- **Claude Code MCP**: `device_start`·`device_look`·`device_press`… 도구로 Claude가 기기를 탐색하고, 찾은 경로를 플로우 후보로 올린다

## 준비물

| 무엇 | 언제 필요 |
| --- | --- |
| macOS, Node.js 22 이상 | 항상 |
| `adb`(Android platform-tools), USB 디버깅을 켠 기기 | Android |
| WebView 디버깅을 켠 dev 빌드: `WebView.setWebContentsDebuggingEnabled(true)` | Android |
| Xcode, Appium + XCUITest 드라이버(WebDriverAgent), `isInspectable = true`인 빌드 | iOS |
| Firebase 서비스 계정, App Store Connect API 키 | 새 빌드 자동 받기(선택) |
| Confluence API 토큰, Figma 토큰 | 정책·피그마 대조(선택) |

점검할 앱이 맞춰야 할 것:

1. **WebView 디버깅**이 켜진 빌드. 디바이스팜은 이 디버깅 소켓으로 들어간다.
2. **경로형 딥링크**: `<scheme>://<웹 경로>`를 받으면 그 웹 경로를 WebView로 연다.
3. **하단 탭이 웹 링크**(`a[href]` 또는 `role=link`)이고, 화면 상단 뒤로 버튼에 이름(`aria-label`)이 있다.
4. 점검용 계정으로 로그인해 둔다. 로그인 화면으로 튕기면 「로그인 필요」로 남는다.

호스트 맥·기기 준비는 [docs/operations.md](https://github.com/Ahnseungc/device-farm/blob/main/docs/operations.md)에 있습니다.

## 설치

```bash
npm install -D @ahnseungchan/device-farm
```

## Quick start

```bash
npx device-farm init           # farm.config.ts, .env.example 생성(이미 있으면 건너뜀)
# farm.config.ts를 내 앱 값으로 고친다. 토큰이 필요하면 .env.example → .env
npx device-farm dev            # http://127.0.0.1:5173 (--port 로 변경)
```

`init`이 만드는 설정은 가상의 쇼핑 앱 「Sample Shop」 예시입니다. 필수 값만 남기면 이 정도입니다.

```ts
// farm.config.ts
import { defineAppConfig } from "@ahnseungchan/device-farm";

export default defineAppConfig({
  name: "My App",
  appIds: { dev: "com.example.app.dev", prod: "com.example.app" },
  web: { dev: "https://dev.app.example.com", prod: "https://app.example.com" },
  homePath: "/home",
  homeTabName: "홈",
  tabPaths: { 검색: "/search", 마이: "/my" },
  deepLink: { scheme: "myapp", homeHost: "home" },
});
```

`.gitignore`에 `.env`와 `test-results/`를 넣어 두세요. 결과(실행 기록·스크린샷·기준 화면·화면 지도)는 전부 작업 폴더의 `test-results/`에 쌓입니다.

## 앱 설정 (`farm.config.ts`)

`defineAppConfig()`가 빠진 값을 기본값으로 채웁니다. 타입은 `AppConfigInput`·`AppConfig`로 패키지에서 가져올 수 있습니다.

| 필드 | 필수 | 설명 |
| --- | --- | --- |
| `name` | ✓ | 앱 이름. 화면 제목·프롬프트에 쓴다 |
| `appIds` | ✓ | `{ dev, prod }` Android 패키지 = iOS 번들 id. 다르면 `iosBundleIds` |
| `homePath`·`homeTabName`·`tabPaths` | ✓ | 홈 경로, 홈 탭 이름, 하단 탭 이름 → 경로 |
| `web` |  | `{ dev, prod }` WebView 웹 주소. 비면 `FARM_WEB_ORIGIN_DEV`·`FARM_WEB_ORIGIN_PROD` |
| `apiOrigin` |  | API 호스트(웹과 다를 때). 가드가 내부로 보고 데이터 QA가 부른다 |
| `inPageBackNames` |  | 화면 상단 뒤로 버튼 이름. 기본 `["뒤로가기", "Back"]` |
| `loginPaths`·`appErrorText` |  | 로그인 화면 경로, 앱 오류 문구. 기본 `["/login"]`, `"Application error"` |
| `deepLink` |  | `{ scheme, homeHost }` 경로형 딥링크 |
| `android.mainActivity` |  | WebView 액티비티. 다른 네이티브 화면이 위에 있으면 뒤로 키로 닫는다 |
| `webview` |  | `stackResetScript`(WebView 스택 닫기 브리지), `sheetCloseName`(시트 닫기 버튼) |
| `guard` |  | 기본 금지어·금지 API에 더할 `extraForbiddenButtonWords`·`extraForbiddenClickNames`·`extraForbiddenApiPatterns`, 늘 통과시킬 `pushTokenRequests`, 누르지 않을 `avoidedNamePattern`·`noPressPathPattern` |
| `scenarios`·`excludedScenarioPaths` |  | 고정 주소 화면 점검 목록과 뺄 경로 |
| `qa` |  | `{ screens, sessionPath }` 데이터 QA 화면·규칙, 로그인 세션 경로 |
| `policy.confluence` |  | `{ cloudId, spaceKey, titleQuery, siteUrl }` 정책 정본 |
| `figma` |  | `{ frontRepo, ref, appDir }` 화면 → 피그마 노드를 뽑을 프론트 체크아웃 |
| `install` |  | `sources`(플랫폼·빌드별 `firebase`/`testflight`), `firebase`(앱 id), `testflightDevAppName` |
| `ios` |  | `{ teamId, wdaBundleId }` WDA 서명. 비면 `IOS_TEAM_ID`·`IOS_WDA_BUNDLE_ID` |
| `access.allowedDomains` |  | 화면에 들어올 수 있는 Tailscale 계정 도메인. 비면 이 맥에서만 |

데이터 QA 규칙용 도우미 `equalWon`·`formatWon`·`numberAt`·`textHas`·`pick`도 패키지 루트에서 내보냅니다.

설정 파일은 `FARM_CONFIG` → 작업 폴더 `farm.config.ts` → `farm.config.example.ts` 순으로 찾습니다. 비밀 값과 이 맥에만 해당하는 값은 작업 폴더 `.env`에 둡니다(항목은 `.env.example` 참고).

## CLI

모든 명령은 작업 폴더(내 프로젝트) 기준으로 설정·`.env`를 읽고 결과를 씁니다. `npx device-farm <명령> --help`로 옵션을 볼 수 있습니다.

| 명령 | 내용 |
| --- | --- |
| `device-farm init` | `farm.config.ts`·`.env.example` 생성 |
| `device-farm dev [--port 5173]` | 화면 + API 서버(127.0.0.1). 새 빌드 감시·정책 감시가 함께 돈다 |
| `device-farm check --build dev\|prod --version 2.1.5 [--devices all\|id,id] [--port 5173]` | 떠 있는 서버에 빌드 점검을 시키고 끝날 때까지 진행을 출력 |
| `device-farm explore [--devices all\|id,id] [--build dev] [--port 5173]` | 탐색 점검(서버 필요) |
| `device-farm chaos --device <serial> [--seed 42] [--episodes 3] [--steps 50] [--minutes 60] [--no-guard]` | 카오스 탐색(Android dev) |
| `device-farm record --device <serial> [--seconds 300] [--name "플로우 이름"]` | 사람 조작 녹화 → 화면 지도·플로우 후보 |
| `device-farm qa --device <id> [--path /cart]` | 데이터 QA만 |
| `device-farm policy-watch [--extract <pageId>] [--figma]` | 정책 바뀜 감지·규칙 뽑기·피그마 문구 |
| `device-farm policy-check --device <id> [--path /my/orders]` | 정책·피그마 대조를 기기 한 대에서 |
| `device-farm explore-allowlist` | OpenAPI(`FARM_OPENAPI_URL`)의 쓰기 API를 `explore/allowlist.json`에 deny로 추가 |
| `device-farm mcp` | Claude Code용 MCP 서버(stdio) |

탐색 허용 목록 `explore/allowlist.json`, 입력칸 테스트 값 `explore/form-values.json`, 정책 등록 `policy/sources.json`은 작업 폴더에 두고 커밋합니다. 허용 목록이 없으면 모든 쓰기 요청을 막습니다.

## Claude Code (MCP)

내 프로젝트 폴더에서 MCP 서버를 등록합니다.

```bash
claude mcp add --scope project device-farm -- npx device-farm mcp
```

도구 흐름: `device_start` → `device_look` / `device_press` / `device_go_home` / `device_report_issue` → `device_finish`. 끝나면 화면 지도에 합치고, 홈부터 다시 돌 수 있는 경로면 플로우 후보로 올립니다. 보고서는 `test-results/agent/<시각>/report.json`. 탐색은 Android dev 빌드에서 쓰기 요청 가드를 켠 채로만 돕니다.

이 저장소는 Claude Code 플러그인(`.claude-plugin`, `skills/run-check`·`chaos-explore`·`policy-figma-check`)으로도 쓸 수 있습니다. 저장소를 받아 `npm install`한 뒤 플러그인으로 추가하세요.

## 안전

- 탐색·버튼 눌러보기·카오스·MCP 탐색은 **Android dev 빌드**에서, 쓰기 요청 가드를 켠 채로 돈다. 가드를 못 걸면 시작하지 않는다(fail closed).
- 가드 판단 순서: 읽기(GET·HEAD·OPTIONS) 통과 → `pushTokenRequests` 통과 → 금지 경로 차단 → 허용 목록 allow 통과 → deny·모름 차단.
- 기본 금지 버튼(구매·결제·매도·매수·송금·출금·탈퇴·주문·환불·해지·삭제·로그아웃 등)은 목록에서 빠지고, 눌러도 거절한다. 앱 설정은 금지어를 **더할** 뿐 빼지 못한다. 비밀번호·PIN 화면은 누르지 않고 나가기만 한다.
- `chaos --no-guard`는 쓰기 요청을 막지 않는다. **dev 서버에서만** 쓴다. 금지 버튼은 그대로 누르지 않는다.
- 화면 서버는 127.0.0.1에만 열린다. 밖에서는 `tailscale serve`로만 들어오고, `access.allowedDomains`로 계정 도메인을 제한한다.

## FAQ

**기기 없이 화면만 열어 볼 수 있나요?**
네. `npx device-farm init && npx device-farm dev`면 예시 설정으로 화면이 열립니다. 기기 목록은 비어 있고 점검은 돌지 않습니다.

**iOS도 탐색·카오스가 되나요?**
빌드 점검·원격 조작은 iOS(Appium)를 지원합니다. 탐색·카오스·녹화·MCP 탐색은 지금 Android dev 빌드만 지원합니다.

**`check`가 서버에 연결할 수 없다고 합니다.**
`check`·`explore`는 떠 있는 `device-farm dev` 서버에 작업을 시킵니다. 다른 터미널에서 `dev`를 먼저 켜고, 포트를 바꿨다면 같은 `--port`를 넘기세요.

**LLM 키가 꼭 필요한가요?**
아니요. 점검·탐색·카오스·데이터 QA는 규칙으로만 판정합니다. PRD로 플로우 후보를 만들 때(`FLOW_LLM_*`)와 정책 판정에만 씁니다. MCP는 사용자의 Claude Code 계정으로 돕니다.

**결과 파일은 어디에 생기나요?**
작업 폴더의 `test-results/`. 커밋하지 마세요.

## 문서

- [운영: 호스트 맥과 기기 준비](https://github.com/Ahnseungc/device-farm/blob/main/docs/operations.md)
- [설계: 빌드 점검·기준 화면·플로우·화면 지도](https://github.com/Ahnseungc/device-farm/blob/main/docs/design-device-farm.md)
- [설계: 탐색 점검과 쓰기 요청 가드](https://github.com/Ahnseungc/device-farm/blob/main/docs/design-explore.md)
- [설계: 카오스 탐색](https://github.com/Ahnseungc/device-farm/blob/main/docs/design-chaos.md)
- [설계: 정책·피그마 대조](https://github.com/Ahnseungc/device-farm/blob/main/docs/design-policy-figma.md)

## 개발

```bash
git clone https://github.com/Ahnseungc/device-farm.git && cd device-farm
npm install
npm run dev          # 화면 개발(vite dev). 저장소 루트 farm.config.ts → farm.config.example.ts
npm run typecheck && npm test
npm run build        # dist/: bin·설정 타입(tsup), 화면(vite build), init 템플릿
```

npm workspaces 모노레포입니다. 의존 방향은 `core ← devices ← engine ← server ← apps`이고 `tools/boundaries.test.ts`가 지킵니다. 배포 패키지는 워크스페이스를 `dist/`에 묶어 냅니다.

## License

[MIT](https://github.com/Ahnseungc/device-farm/blob/main/LICENSE)

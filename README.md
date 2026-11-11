# 디바이스팜 (device-farm)

화면이 WebView 웹앱인 모바일 앱을 **실기기**에서 QA 자동화하는 디바이스팜이다. Android는 adb + Chrome DevTools Protocol(Playwright), iOS는 Appium(XCUITest·WebDriverAgent)으로 앱 안 WebView를 직접 조작한다.

점검 대상 앱은 코드에 없다. 패키지 id·웹 주소·하단 탭·금지어·시나리오 같은 앱마다 다른 값은 전부 `farm.config.ts` 하나로 **주입**한다. 같은 저장소로 어떤 WebView 앱이든 점검할 수 있다.

## 하는 일

| 기능 | 내용 | 판정 |
| --- | --- | --- |
| 빌드 점검 | 새 빌드를 Firebase App Distribution·TestFlight에서 받아 연결된 기기 전부에 깔고 고정 주소 화면을 딥링크로 열어 본다 | 앱 오류 문구·로그인 튕김·빈 화면·기준 화면 픽셀 비교 |
| 버튼 눌러보기 | 열린 화면의 버튼을 하나씩 눌러 반응(이동·팝업·반응 없음·오류)을 본다. 결과가 **화면 지도**가 된다 | 규칙 |
| 플로우 | 홈에서 버튼·링크만 눌러 가는 시나리오. PRD로 LLM이 후보를 만들거나, 화면 지도 블록을 이어 붙이거나, 사람·에이전트 조작을 기록해 만든다. 사람이 확정한 것만 돈다 | 문구 확인 |
| 데이터 QA | 화면이 부르는 GET API를 다시 불러 합계·표시 값을 규칙으로 맞춰 본다 | 규칙(LLM 없음) |
| 탐색 점검 | 홈부터 너비 우선으로 누르며 오류 화면을 찾는다. 쓰기 요청은 허용 목록으로 막는다 | 규칙 |
| 카오스 탐색 | 뒤로·연타·로딩 중 뒤로·백그라운드·재시작을 섞어 시드 고정 무작위로 돈다 | 규칙 |
| 정책·피그마 대조 | Confluence 정책 문서와 피그마 문구를 화면과 맞춰 본다 | 글자 비교 + Claude 판정 |
| 원격 조작 | 웹 화면에서 기기 화면을 보며(Android H.264, iOS MJPEG) 직접 누른다. 조작 중인 기기는 잠근다 | — |
| Claude Code | MCP 도구로 Claude가 기기를 탐색하고, 찾은 경로를 플로우 후보로 올린다 | 사람이 확인 |

## 구조

```
                    farm.config.ts (앱 설정, 커밋하지 않음)
                              │ loadAppConfig()
        ┌─────────────────────┼──────────────────────┐
        ▼                     ▼                      ▼
   apps/web (화면)        apps/cli (터미널)       apps/mcp (Claude Code)
   React + Vite          device-run·chaos·qa…    device_start/look/press…
        │ vite 플러그인          │                      │
        ▼                     ▼                      ▼
   packages/server  ── 기기 목록·잠금·작업 게이트·HTTP API·새 빌드 감시·정책 감시
        ▼
   packages/engine  ── 점검·탐색·카오스 실행, 결과·기준 화면·플로우·화면 지도 저장
        ▼
   packages/devices ── Android(adb·CDP)·iOS(Appium) 드라이버, 설치, 스트림, 로그
        ▼
   packages/core    ── 순수 도메인 로직·타입. node·외부 패키지 없음. AppConfig 타입
```

- npm workspaces. 의존 방향은 `core ← devices ← engine ← server ← apps`이고 `tools/boundaries.test.ts`가 지킨다. 화면(`apps/web`)은 `core`만 쓴다(서버는 `vite.config.ts`에서만).
- 각 패키지는 `exports: { "./*": "./src/*.ts" }`로 TypeScript 소스를 그대로 내보낸다. 빌드 단계 없이 `tsx`·Vite가 읽는다.
- `core`는 전역 설정을 들고 있지 않는다. 앱 설정은 함수 인자나 `ScreenDriver.app`으로 넘긴다.

## 빠른 시작

필요: macOS, Node 22 이상, Android는 `adb`(platform-tools), iOS는 Xcode·Appium(XCUITest 드라이버). 자세한 호스트 준비는 [docs/operations.md](docs/operations.md).

```bash
npm install
cp farm.config.example.ts farm.config.ts   # 내 앱 값으로 고친다
cp .env.example .env                       # 토큰·이 맥에만 해당하는 값
npm run dev                                # http://127.0.0.1:5173 (FARM_PORT로 변경)
```

`farm.config.ts`가 없으면 예시 앱(가상의 「Sample Shop」) 설정으로 뜬다. 화면은 열리지만 실제 앱이 없으니 기기 점검은 돌지 않는다.

검사:

```bash
npx tsc --noEmit
npm test        # 모든 *.test.ts를 tsx로 돈다(기기 없이)
```

## 앱 준비

점검 대상 앱이 맞춰야 할 것:

1. **WebView 디버깅**: Android는 `WebView.setWebContentsDebuggingEnabled(true)`인 dev 빌드, iOS는 `isInspectable = true`. 디바이스팜은 이 디버깅 소켓으로 들어간다.
2. **경로형 딥링크**: `<scheme>://<웹 경로>`를 받으면 그 웹 경로를 WebView 스택으로 연다. 화면 점검이 실제 사용자 진입(푸시·링크)과 같은 길로 화면을 연다.
3. **하단 탭이 웹 링크**(`a[href]` 또는 `role=link`)이고, 화면 상단 뒤로 버튼에 이름(`aria-label`)이 있다.
4. (선택) 열린 WebView 스택을 모두 닫는 앱 브리지. 있으면 `webview.stackResetScript`에 넣는다.
5. 점검용 계정으로 로그인해 둔다. 로그인 화면으로 튕기면 「로그인 필요」로 남는다.

## 앱 설정 (`farm.config.ts`)

`packages/core/src/config/app-config.ts`의 `AppConfig`. `defineAppConfig()`가 빠진 값을 기본값으로 채운다. 예시는 [farm.config.example.ts](farm.config.example.ts).

| 필드 | 필수 | 설명 |
| --- | --- | --- |
| `name` | ✓ | 앱 이름. 프롬프트·화면 제목에 쓴다 |
| `appIds` | ✓ | `{ dev, prod }` Android 패키지 = iOS 번들 id. 다르면 `iosBundleIds` |
| `homePath`·`homeTabName`·`tabPaths` | ✓ | 홈 경로, 홈 탭 이름, 하단 탭 이름 → 경로 |
| `web` |  | `{ dev, prod }` WebView 웹 주소. 비면 `FARM_WEB_ORIGIN_*` |
| `apiOrigin` |  | API 호스트(웹과 다를 때). 가드가 내부로 보고 데이터 QA가 부른다 |
| `inPageBackNames` |  | 화면 상단 뒤로 버튼 이름. 기본 `["뒤로가기", "Back"]` |
| `loginPaths`·`appErrorText` |  | 로그인 화면 경로, 앱 오류 문구. 기본 `["/login"]`, `"Application error"` |
| `deepLink` |  | `{ scheme, homeHost }` 경로형 딥링크 |
| `android.mainActivity` |  | WebView 액티비티. 다른 앱 내부 화면이 위면 뒤로 키로 닫는다 |
| `webview` |  | `stackResetScript`(스택 닫기 브리지), `sheetCloseName`(시트 닫기 버튼) |
| `guard` |  | 기본 금지어·금지 API 경로에 더할 `extraForbiddenButtonWords`·`extraForbiddenClickNames`·`extraForbiddenApiPatterns`, 늘 통과시킬 `pushTokenRequests`, 누르지 않을 `avoidedNamePattern`·`noPressPathPattern` |
| `scenarios`·`excludedScenarioPaths` |  | 고정 주소 화면 점검 목록과 뺄 경로 |
| `qa` |  | `{ screens, sessionPath }` 데이터 QA 화면·규칙, 로그인 세션 경로 |
| `policy.confluence` |  | `{ cloudId, spaceKey, titleQuery, siteUrl }` 정책 정본 |
| `figma` |  | `{ frontRepo, ref, appDir }` 화면 → 피그마 노드를 뽑을 프론트 체크아웃 |
| `install` |  | `sources`(플랫폼·빌드별 firebase/testflight), `firebase`(앱 id), `testflightDevAppName` |
| `ios` |  | `{ teamId, wdaBundleId }` WDA 서명. 비면 `IOS_TEAM_ID`·`IOS_WDA_BUNDLE_ID` |
| `access.allowedDomains` |  | 화면에 들어올 수 있는 Tailscale 계정 도메인. 비면 이 맥에서만 |

기본 금지어(누르지 않는 버튼): 구매·결제·매도·매수·송금·출금·탈퇴·배송 신청·주문·환불·해지·삭제·인출·선물·충전·로그아웃·공유하기 등. 기본 금지 API 경로: order·pay·purchase·sell·trade·transfer·withdraw·account·resign·delivery·card 등(부분 일치, 대소문자 무시). 앱 설정은 여기에 **더할** 뿐 빼지 못한다.

### 설정을 어디서 읽나

| 진입점 | 찾는 순서 |
| --- | --- |
| `npm run dev`(서버) | `FARM_CONFIG` → 저장소 루트 `farm.config.ts` → `farm.config.example.ts` |
| CLI(`npm run …`) | `FARM_CONFIG` → 작업 폴더 `farm.config.ts` → `farm.config.example.ts` |
| MCP 서버 | `FARM_CONFIG` → Claude Code를 연 폴더의 `farm.config.ts` → 저장소 루트 순 |

저장소 밖(내 앱 프로젝트)에 둔 설정은 `@device-farm/core`를 못 불러올 수 있다. 그때는 타입만 가져와 그냥 객체로 내보낸다. 로더가 `defineAppConfig()`를 대신 부른다.

```ts
import type { AppConfigInput } from "<device-farm 경로>/packages/core/src/config/app-config";

export default {
  name: "My App",
  appIds: { dev: "com.example.app.dev", prod: "com.example.app" },
  homePath: "/home",
  homeTabName: "홈",
  tabPaths: { 검색: "/search", 마이: "/my" },
  deepLink: { scheme: "myapp", homeHost: "home" },
} satisfies AppConfigInput;
```

## 명령

| 명령 | 내용 |
| --- | --- |
| `npm run dev` | 화면 + API 서버. 시작하면 새 빌드 감시·정책 감시가 돈다 |
| `npm run device-run -- --build dev --version 2.1.5 [--devices all\|id,id]` | 서버에 점검을 시키고 끝날 때까지 진행을 출력 |
| `npm run device-explore -- [--devices …]` | 탐색 점검 |
| `npm run chaos -- --device <serial> [--seed 42] [--episodes 3] [--steps 50] [--minutes 60] [--no-guard]` | 카오스 탐색 |
| `npm run qa -- --device <id> [--path /cart]` | 데이터 QA만 |
| `npm run record -- --device <serial> [--seconds 300] [--name …]` | 사람 조작 기록 → 화면 지도·플로우 후보 |
| `npm run policy-watch [-- --extract <pageId> \| --figma]` | 정책 바뀜 감지·규칙 뽑기·피그마 문구 |
| `npm run policy-check -- --device <id> [--path …]` | 정책·피그마 대조를 기기 한 대에서 |
| `npm run explore-allowlist` | OpenAPI(`FARM_OPENAPI_URL`)의 쓰기 API를 허용 목록에 deny로 추가 |
| `npm run device-mcp` | MCP 서버를 직접 띄움(보통은 Claude Code가 띄운다) |

결과는 모두 `test-results/` 아래에 남는다(커밋하지 않는다). 허용 목록 `explore/allowlist.json`, 입력값 `explore/form-values.json`, 정책 등록 `policy/sources.json`은 커밋하는 파일이다.

## 안전

- 탐색·버튼 눌러보기·카오스·MCP 탐색은 **Android dev 빌드**에서만, 쓰기 요청 가드를 켠 채로 돈다. 가드를 못 걸면 시작하지 않는다(fail closed).
- 가드 판단 순서: 읽기(GET·HEAD·OPTIONS) 통과 → `pushTokenRequests` 통과 → 금지 경로 차단 → 허용 목록 allow 통과 → deny·모름 차단.
- 금지어 버튼은 목록에서 빠지고, 눌러도 거절한다. 비밀번호·PIN 화면은 누르지 않고 나가기만 한다.
- 정책 판정에 보내는 스크린샷은 개인정보로 보이는 경로(account·bank·verify·password…)에서 빼고 글자로만 판정한다.
- 화면은 127.0.0.1에만 열리고, 밖에서는 `tailscale serve`로만 들어온다. 계정 도메인을 `access.allowedDomains`로 제한한다.

## Claude Code 플러그인

이 저장소는 Claude Code 플러그인이기도 하다.

- `.claude-plugin/plugin.json` — 플러그인 정보
- `.mcp.json` — `device-farm` MCP 서버(기기 탐색 도구). 저장소 폴더에서 Claude Code를 열어도, 플러그인으로 깔아도 같은 파일을 쓴다
- `skills/run-check`·`skills/chaos-explore`·`skills/policy-figma-check` — 디바이스팜을 모는 방법

플러그인으로 쓸 때도 이 저장소에서 `npm install`을 한 번 해야 한다(MCP 서버가 `node_modules/tsx`로 뜬다). 점검할 앱의 `farm.config.ts`는 Claude Code를 여는 프로젝트 폴더에 두거나 `FARM_CONFIG`로 알려 준다.

MCP 도구: `device_start` → `device_look` / `device_press` / `device_go_home` / `device_report_issue` → `device_finish`. 끝나면 화면 지도에 합치고, 홈부터 다시 돌 수 있는 경로면 플로우 후보로 올린다. 보고서는 `test-results/agent/<시각>/report.json`.

## 문서

- [docs/operations.md](docs/operations.md) — 호스트 맥 준비, Android·iOS 기기, 상시 실행, 원격 접속
- [docs/design-device-farm.md](docs/design-device-farm.md) — 빌드 점검·기준 화면·플로우·화면 지도
- [docs/design-explore.md](docs/design-explore.md) — 탐색 점검과 쓰기 요청 가드
- [docs/design-chaos.md](docs/design-chaos.md) — 카오스 탐색
- [docs/design-policy-figma.md](docs/design-policy-figma.md) — 정책·피그마 대조

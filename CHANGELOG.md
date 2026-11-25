# Changelog

`@ahnseungchan/device-farm`의 바뀐 점을 적는다.

## [Unreleased]

### Added

- 점검 대기열: 기기 점검·탐색·봇 점검을 서버 큐 하나에 쌓아 차례로 돌린다(409로 막지 않음). 플로팅의 대기 목록·「빼기」, `GET /queue`·`POST /queue/cancel`, 급한 작업이 도는 점검을 밀어내고 끝나면 이어서 돌린다
- 팝업 가드: 점검·플로우 중 뜬 팝업을 「팝업 · 제목」 결과로 남기고 사람처럼 닫은 뒤 이어 간다. 「다시 보지 않기」류는 누르지 않는다(앱 설정 `popups`)
- 네트워크·서버 오류 화면: 「웹페이지를 사용할 수 없음」·배포 중 502를 다시 불러오며 기다리고, 안 풀리면 앱을 다시 켠다. 쉬는 Android 기기도 지켜본다
- 「점검 못 함」 상태: 기기·연결·서버·계정 상태 탓 실패를 앱 실패와 나눈다. 실패하면 한 번 다시 돌리고, 같은 이유가 이어지면 남은 점검을 건너뛴다
- 플로우 스텝 `watchAd`(광고를 끝까지 보고 잔액이 느는지 확인, 앱 설정 `ads`)·`relaunch`(앱 다시 켜기)·`fast`(시간 제한 화면), 플로우 `retry: false`
- 로그아웃된 앱을 기기에 저장된 카카오 계정으로 다시 로그인(앱 설정 `login.kakao`, 기본 꺼짐. 비밀번호는 넣지 않는다), 앱 알림 권한 창 허용(`android.notificationAppLabel`)
- 슬랙 QA 제보(env로 켬, `SLACK_CHANNEL_QA`·`SLACK_QA_MENTION_IDS`): 태그한 제보를 Claude가 플로우로 바꿔 기기에서 돌리고 스레드에 결과·화면·의견을 단다(앱 설정 `qaReport`)
- 슬랙: 점검 시작 알림, 끝 알림을 앱 실패·점검 못 함·화면 바뀜으로 나누고 실패 이름을 적는다. 실패 알림 「문제 아님」은 다음 점검부터 같은 실패를 통과로 넘긴다
- 정책 문구가 글자 그대로 없으면 Claude가 뜻으로 다시 보고, 같은 뜻이면 「같은 뜻, 다른 문구」로 통과
- 기준 확정 뒤 첫 세 번은 바뀌는 곳(시세·잔액·시각)을 배워 비교에서 뺀다
- 앱 설정: `ads`, `popups`, `login.kakao`, `qaReport`, `uncheckedPathPrefixes`, `android.notificationAppLabel`·`android.devOverlay`, `guard.harmlessBlockedPatterns`

### Changed

- 예약 점검(`FARM_NIGHTLY=1`): 03시 플로우 점검 대신 3시간마다 전체 점검(버튼 눌러보기 없이, 설치 없이)을 돌린다. 봇 점검은 그대로 03:30
- 기본 금지어에 「보지 않기」·「그만 보기」를 더한다
- 버튼 눌러보기: 앱 사이트·API 밖 요청 실패는 에러로 세지 않고, 쓰기 차단은 버튼을 누르는 동안만 켠다. 화면 하나에서 난 오류로 기기 점검 전체를 끝내지 않는다

### Fixed

- 같은 경로의 웹 화면이 둘이면 화면에 그려지는 쪽을 읽는다. 다시 붙은 연결에도 쓰기 차단·로그 수집을 다시 건다
- 멈춘 WebView(20초)·플로우(10분)에 시간 제한을 둔다. 광고 오퍼월 뒤 꺼진 WebView 디버깅, 무시된 딥링크, 앞에 남은 다른 앱을 앱을 다시 켜서 푼다

## [0.2.0] - 2026-11-17

### Added

- 실행 기록·정책 스냅샷·화면 지도를 SQLite(`farm.db`, `node:sqlite`)에 쌓는다. 옛 JSON 기록은 `db-import`로 옮긴다
- 화면 깨짐 점검(`layout-check`): 넘침·잘림·겹침·하단 잘림·빈 화면. 봇 점검은 처음 본 화면마다 잰다
- 디자인 점검 탭: 화면별 피그마 일치율, 30% 미만은 「피그마 확인 필요」로 따로 센다. 플로우 「디자인 확인」 스텝·입력 스텝
- 봇 점검: 깊은 화면에서 시작, 입력칸 채우기, 다른 앱 다녀온 뒤 빈 화면 확인, 원인별 묶음과 Claude 한 줄 원인 요약
- 진행 중 플로팅에 모든 점검을 띄우고 점검마다 중지(`POST /jobs/stop`). 오늘 요약·문제 화면
- 슬랙(env로 켬, `SLACK_BOT_TOKEN`): 실패·버그 후보 즉시 알림, 정책 불일치 버튼 처리, 점검 끝 한 줄 요약, 풀어 쓴 오류 문구, 수정 PR 버튼(`FARM_FIX_PR_GITHUB_TOKEN`·`FARM_FIX_PR_REPO`)
- 야간 점검(`FARM_NIGHTLY=1`, 03:00 플로우·03:30 봇)과 아침 Claude 요약(`FARM_DAILY_REPORT=1`, `daily-report`)
- 팀 비밀번호 로그인 + HTTPS 사내망 모드(`FARM_PASSWORD_HASH`·`FARM_TLS_CERT`·`FARM_TLS_KEY`·`FARM_PUBLIC_ORIGIN`, `farm-password`)
- 앱 설정: `homeTabLabels`(홈 탭 글자 후보), `introScreens`(넘길 안내 화면), `webview.overlayCloseScript`(위에 뜬 상담창 등 닫기)

### Changed

- Node 22.13 이상(`node:sqlite`)
- Android 누르기: 위치가 멈출 때까지 기다리고 가려진 요소는 누르지 않는다. 앱이 꺼져 있으면 먼저 띄운다
- 실시간 화면: 끊기면 5번까지 다시 붙고 첫 화면을 바로 보낸다

## [0.1.3] - 2026-11-11

### Added

- 웹 화면 영어 지원: `apps/web/i18n.ts`(`t("한국어", "English")`·`setLocale`·`dateLocale`)로 탭·버튼·라벨·안내·빈 화면·다이얼로그·상태 배지·aria-label을 한국어/영어로 낸다. 날짜·시각 표기도 언어를 따른다
- 앱 설정 `locale: "ko" | "en"`(기본 `"ko"`). 환경 변수 `FARM_LOCALE=en`이 설정보다 먼저다. 화면은 `/api/devices/app`의 `locale`을 받아 언어를 정한다. 기본 동작(한국어)은 그대로

### Changed

- 데모(`apps/web/demo/`)를 영어로: 가상 앱 「Sample Shop」 데이터(기기·점검 메시지·화면 지도·플로우·카오스·정책 규칙)와 SVG 폰 화면을 영어로 바꿈. 데모 HTML은 `lang="en"`
- `docs/assets/demo.gif`를 영어 데모로 다시 녹화
- README FAQ 「Why is the UI in Korean?」을 「Is the UI available in English?」로 바꾸고 Configuration 표에 `locale`을 추가(한국어 문서도 같이)

## [0.1.2] - 2026-11-11

### Docs

- README를 영어로 다시 쓰고 webview-kit README 형식(배지·한 줄 소개·데모 GIF·Live demo·Features·Install·FAQ·Contributing)으로 맞춤. Why 표는 빼고 기능·사용법만 둠. npm 패키지 설명을 영어로 바꿈. 한국어 문서는 `docs/README.ko.md`로 옮김
- `docs/assets/demo.gif` 추가: 데모 화면을 Playwright로 녹화해 ffmpeg로 만든다(`tools/record-demo-gif.ts`)

### Added

- 데모 모드(`apps/web/demo/`): 서버·기기 없이 가상 앱 「Sample Shop」 가짜 데이터로 화면을 띄운다. 바꾸는 버튼은 「Demo mode: read-only」 토스트만 띄운다. `npm run demo:dev`·`demo:build`·`demo:preview`(127.0.0.1:5499). npm 패키지에는 들어가지 않는다
- GitHub Actions: CI(typecheck·test·build·데모 빌드), 데모를 GitHub Pages(https://ahnseungc.github.io/device-farm/)에 배포

## [0.1.1] - 2026-11-11

### Docs

- README를 WebViewKit 형식으로 개편: 가운데 정렬 로고·배지·바로가기, 구조 다이어그램(SVG), Why 비교표, 긴 내용은 접기(`<details>`), Contributing
- 로고·구조 다이어그램을 `docs/assets/`에 추가(npm에서도 보이도록 GitHub 절대 URL로 링크, 패키지에는 넣지 않음)

## [0.1.0] - 2026-11-11

### Added

- npm 패키지로 첫 배포. `npm i -D @ahnseungchan/device-farm` 후 `npx device-farm <명령>`으로 쓴다
  - `init`: 작업 폴더에 `farm.config.ts`·`.env.example` 생성(있으면 건너뜀)
  - `dev [--port]`: 미리 빌드한 화면을 vite preview로 열고 기기 API·스트림을 붙인다
  - `check`·`explore`·`chaos`·`record`·`qa`·`policy-watch`·`policy-check`·`explore-allowlist`: 기존 CLI
  - `mcp`: Claude Code용 MCP 서버(stdio). 결과·`.env`·설정은 작업 폴더 기준
- 패키지 루트에서 `defineAppConfig`·`AppConfigInput`·`AppConfig` 타입과 데이터 QA 도우미(`equalWon`·`formatWon`·`numberAt`·`textHas`·`pick`)를 내보낸다
- 빌드: tsup으로 워크스페이스를 `dist/`에 묶고, 화면은 `vite build`, 설정 타입은 `dist/index.d.ts` 하나

### Changed

- `explore/allowlist.json`·`explore/form-values.json`을 작업 폴더에서 읽는다. 없으면 빈 허용 목록(모든 쓰기 요청 차단)·빈 입력값
- MCP 서버는 `FARM_ROOT`가 있으면 그 폴더를 결과·`.env` 기준으로 쓴다

# Changelog

`@ahnseungchan/device-farm`의 바뀐 점을 적는다.

## [Unreleased]

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

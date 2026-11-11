# Changelog

`@ahnseungchan/device-farm`의 바뀐 점을 적는다.

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

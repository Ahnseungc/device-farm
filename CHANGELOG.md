# Changelog

`@ahnseungchan/device-farm`의 바뀐 점을 적는다.

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

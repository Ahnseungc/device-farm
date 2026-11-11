---
name: run-check
description: 디바이스팜으로 연결된 실기기에서 앱 빌드 점검(설치 → 고정 화면 → 확정 플로우 → 데이터 QA → 정책 대조)을 돌리고 결과를 읽는다. "점검 돌려", "새 빌드 확인", "기기에서 화면 깨졌는지" 같은 요청에 쓴다.
---

# 실기기 점검 돌리기

디바이스팜 서버(`npm run dev`, 기본 127.0.0.1:5173, `FARM_PORT`로 바꿈)가 떠 있어야 한다. 점검 대상 앱은 `farm.config.ts`(없으면 `farm.config.example.ts`)에서 온다.

## 순서

1. 설정 확인: `farm.config.ts`의 `appIds`·`web`·`homeTabName`·`tabPaths`·`deepLink.scheme`이 실제 앱과 맞는지 본다. 비밀 값은 `.env`.
2. 점검 시작(서버가 빌드를 받아 설치하고 돈다):
   ```bash
   npm run device-run -- --build dev --version 2.1.5 [--devices all|id,id] [--port 5173]
   ```
   `--version`은 `2.1.5` 또는 `2.1.5+412`. 끝날 때까지 진행을 출력하고, 실패가 있으면 0이 아닌 코드로 끝난다.
3. 결과: `test-results/devices/<runId>/run.json`, 실패 화면마다 스크린샷·로그·영상 묶음. 웹 화면 「결과」 탭에서도 본다.
4. 기준 화면 후보(`candidate`)는 사람이 「기준 화면」 탭에서 확정한다. 확정 전에는 실패로 보지 않는다.

## 데이터 QA만

```bash
npm run qa -- --device <id> [--path /cart]
```
`farm.config.ts`의 `qa.screens` 규칙만 돈다. `apiOrigin`(또는 `FARM_API_ORIGIN`)이 있어야 한다.

## 주의

- 점검 중인 기기는 봇 잠금이 걸린다. 사람이 조작 중이면 그 기기는 건너뛴다.
- 결과 판정은 규칙(LLM 없음)으로만 한다. 「로그인 필요」는 계정 세션이 풀린 것이다.

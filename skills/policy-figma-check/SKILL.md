---
name: policy-figma-check
description: Confluence 정책 문서와 피그마 디자인 문구를 실기기 앱 화면과 맞춰 본다. 정책 바뀜 감지, 규칙 뽑기(Claude), 화면별 대조, 무시 목록을 다룬다. "정책대로 나오나", "피그마랑 문구 달라" 같은 요청에 쓴다.
---

# 정책·피그마 대조

설정: `farm.config.ts`의 `policy.confluence`(cloudId·spaceKey·titleQuery·siteUrl)와 `figma`(frontRepo·ref·appDir). 토큰은 `.env`의 `CONFLUENCE_EMAIL`·`CONFLUENCE_API_TOKEN`·`FIGMA_TOKEN`. 모두 읽기 전용이다.

## 흐름

1. 정책 바뀜 감지(LLM 없음): 스페이스에서 제목에 `titleQuery`가 든 페이지 + `policy/sources.json` 등록 페이지의 본문 해시를 지난 스냅샷과 비교한다.
   ```bash
   npm run policy-watch
   ```
2. 규칙 뽑기(Claude CLI): 바뀐 페이지에서 화면으로 확인할 수 있는 규칙(문구·값·동작)을 뽑는다. 근거 인용이 본문에 없으면 버린다.
   ```bash
   npm run policy-watch -- --extract <pageId>
   ```
3. 피그마: 프론트 체크아웃에서 화면 → 피그마 노드를 뽑고 노드 문구를 읽는다.
   ```bash
   npm run policy-watch -- --figma
   ```
4. 화면 대조(기기 한 대):
   ```bash
   npm run policy-check -- --device <id> [--path /my/orders]
   ```
   문구 규칙은 글자로, 동작 규칙은 Claude가 스크린샷(개인정보 화면 제외)으로 판정하고 캐시한다.

서버(`npm run dev`)는 위 1~3을 하루 한 번 돌리고, 점검 때 4를 데이터 QA 뒤에 이어서 돈다. 어긋남 분류: 버그 후보 / 앱 반영 전(정책이 막 바뀜) / 정책 문서가 뒤처짐 / 문서 갱신 누락 또는 버그 / 문서끼리 어긋남. 버그 후보만 실패다. 아닌 것은 웹 화면 「정책」 탭에서 무시하면 그 해시가 바뀔 때까지 숨는다.

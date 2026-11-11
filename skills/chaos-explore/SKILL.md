---
name: chaos-explore
description: Android dev 앱을 쓰기 요청 가드를 켠 채 돌아다니며 엣지 케이스를 찾는다. 카오스 탐색(시드 고정 무작위) CLI와, Claude가 MCP 도구(device_start/look/press/go_home/report_issue/finish)로 직접 탐색하는 방법을 다룬다.
---

# 탐색으로 버그 찾기

Android dev 빌드만 탐색한다. iOS는 쓰기 요청을 막을 수 없어 하지 않는다. 금지어(구매·결제·송금·출금·탈퇴… + `farm.config.ts`의 `guard.extraForbiddenButtonWords`)가 든 버튼은 누르지 않고, 허용 목록(`explore/allowlist.json`) 밖 쓰기 요청은 가드가 막는다.

## 카오스 탐색(CLI)

```bash
npm run chaos -- --device <Android serial> [--seed 42] [--episodes 3] [--steps 50] [--minutes 60]
```

- 홈에서 회차를 시작해 누르기·뒤로·탭 바꾸기·연타·로딩 중 뒤로·백그라운드·재시작을 가중치 무작위로 고른다. 같은 시드·같은 앱 상태면 같은 순서다.
- 결과: `test-results/chaos/<runId>/run.json`(스텝마다 후보 점수·고른 행동·판정), 오류 스텝 스크린샷. 웹 화면 「카오스」 탭.
- `--no-guard`는 dev 서버에서만. 금지어 버튼은 그래도 누르지 않는다.
- 디바이스팜 점검이 도는 중이면 시작하지 않는다.

## Claude가 직접 탐색(MCP)

이 플러그인을 켜면 `device-farm` MCP 서버가 붙는다. 도구 순서:

1. `device_start({ task })` — 가드를 켜고 홈으로 가서 첫 화면을 돌려준다.
2. `device_look` → `device_press({ role, name })` 반복. `name`은 목록 글자 그대로. `device_go_home`으로 처음부터.
3. 이상하면 `device_report_issue({ description })` — 무엇을 했더니 무엇이 이상했는지. 디자인 취향은 남기지 않는다.
4. 반드시 `device_finish({ summary })` — 화면 지도에 합치고, 홈부터 다시 돌 수 있으면 플로우 후보로 올리고, 보고서를 `test-results/agent/`에 남긴다.

누르기 횟수 상한(기본 40)이 있다. 「막은 쓰기 요청」 경고가 보이면 그 동작은 실제로 서버에 가지 않은 것이다.

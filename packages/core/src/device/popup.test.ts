import assert from "node:assert/strict";

import { isResultPopup, popupCloseLabel, popupCloseSteps, popupHasButton, type PopupInfo } from "./popup";

const info = (buttons: [string, boolean?][], dim = true): PopupInfo => ({
  title: "안내",
  texts: ["안내"],
  buttons: buttons.map(([name, reachable = true]) => ({ name, reachable })),
  dim: dim ? { x: 200, y: 50 } : null,
});

// 닫기류 버튼 → 딤. 「다시 보지 않기」는 누르지 않는다
assert.deepEqual(popupCloseSteps(info([["다시 보지 않기"], ["닫기"], ["쇼핑 둘러보기"]])), [{ kind: "button", name: "닫기" }, { kind: "dim" }]);
// 가려진 닫기는 못 누른다. 그러면 누를 버튼은 「이동」 하나
assert.deepEqual(popupCloseSteps(info([["닫기", false], ["이동"]])), [{ kind: "dim" }, { kind: "press", name: "이동" }]);
// 「이동」 하나뿐이고 딤도 못 누르면 그 버튼을 누른다
assert.deepEqual(popupCloseSteps(info([["이동"]]), false), [{ kind: "press", name: "이동" }]);
assert.deepEqual(popupCloseSteps(info([["이동"]], false)), [{ kind: "press", name: "이동" }]);
// 딤이 있으면 누르기 전에 딤부터
assert.deepEqual(popupCloseSteps(info([["이동"]])), [{ kind: "dim" }, { kind: "press", name: "이동" }]);
// 버튼이 여럿이고 닫기·딤이 없으면 고르지 않는다(닫지 못함)
assert.deepEqual(popupCloseSteps(info([["충전하기"], ["충전 취소하기"]], false)), []);

// 앱이 더한 닫기 이름은 기본 닫기 뒤에 본다
assert.deepEqual(popupCloseSteps(info([["새로 쓰기"], ["이어서 쓰기"]], false)), []);
assert.deepEqual(popupCloseSteps(info([["새로 쓰기"], ["이어서 쓰기"]], false), true, ["새로 쓰기"]), [{ kind: "button", name: "새로 쓰기" }]);
// 결과 팝업은 앱 설정 글자로만 알아본다
assert.equal(isResultPopup({ title: "아쉽게도 시간이 초과됐어요", texts: [] }, ["시간이 초과됐어요"]), true);
assert.equal(isResultPopup({ title: "아쉽게도 시간이 초과됐어요", texts: [] }, []), false);

assert.equal(popupCloseLabel(null), "닫지 못함");
assert.equal(popupCloseLabel({ kind: "press", name: "이동" }), "닫기가 없어 「이동」을 누름");
assert.equal(popupHasButton(info([["충전 취소하기"]]), "충전 취소"), false);
assert.equal(popupHasButton(info([["충전 취소하기"]]), "충전 취소", "prefix"), true);

console.log("popup ok");

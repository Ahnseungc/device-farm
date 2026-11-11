import assert from "node:assert/strict";

import { sampleCartQa } from "../config/sample-app";
import { formatWon, pick, runRule, textHas, type QaContext } from "./rules";

const good = (): QaContext => ({
  responses: { cart: { totalWon: 31_000, items: [{ priceWon: 12_000 }, { priceWon: 19_000 }] } },
  text: "장바구니\n상품 2개\n합계\n31,000\n원",
});

const check = (id: string, context: QaContext) => {
  const rule = sampleCartQa.rules.find((entry) => entry.id === id);
  assert.ok(rule, id);
  return runRule(rule, context);
};

assert.equal(formatWon(989946088), "989,946,088");
assert.equal(textHas("1,000,000\n원", "1,000,000원"), true);
assert.equal(pick({ a: { b: 1 } }, "a.b"), 1);
assert.equal(pick({ a: 1 }, "a.b"), undefined);

// 정상 응답이면 규칙 전부 통과
for (const rule of sampleCartQa.rules) assert.deepEqual(runRule(rule, good()), { id: rule.id, title: rule.title, ok: true }, rule.id);

// 합계가 항목 합과 다르면 실패
{
  const context = good();
  (context.responses.cart as { totalWon: number }).totalWon = 32_000;
  assert.match(check("total-equals-items", context).message ?? "", /합계: 32,000원인데 31,000원/);
}

// 화면에 합계가 안 보이면 어느 값인지 알려 준다
{
  const context = { ...good(), text: good().text.replace("31,000", "30,000") };
  assert.match(check("total-shown", context).message ?? "", /합계 「31,000원」/);
}

// 응답 모양이 다르면 예외 대신 실패 사유
assert.match(check("total-equals-items", { responses: {}, text: "" }).message ?? "", /cart.items가 배열이 아닙니다/);
assert.match(check("total-shown", { responses: {}, text: "" }).message ?? "", /cart.totalWon 값이 숫자가 아닙니다/);

console.log("qa rules ok");

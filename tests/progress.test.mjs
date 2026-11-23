import { test } from "node:test";
import assert from "node:assert/strict";
import { conversationProgress } from "../public/logic.js";

const o = (alex, jordan) => ({ alex, jordan });

test("start of session: empty bar and an opening hint", () => {
  const p = conversationProgress("exploring", o(0, 0), 0);
  assert.equal(p.percent, 0);
  assert.match(p.hint, /why you are meeting/);
});

test("percent grows with openness and never reaches 100 before resolved", () => {
  const a = conversationProgress("exploring", o(1, 1), 2).percent;
  const b = conversationProgress("exploring", o(3, 3), 5).percent;
  assert.ok(a > 0 && b > a);
  assert.ok(conversationProgress("accepted_by_one", o(3, 3), 8).percent < 100);
});

test("proposal and acceptance add progress", () => {
  const base = conversationProgress("exploring", o(2, 2), 4).percent;
  const pending = conversationProgress("proposal_pending", o(2, 2), 4).percent;
  const one = conversationProgress("accepted_by_one", o(2, 2), 4).percent;
  assert.ok(base < pending && pending < one);
});

test("resolved is exactly 100", () => {
  assert.equal(conversationProgress("resolved", o(3, 3), 6).percent, 100);
});

test("hint names the more guarded resident", () => {
  assert.match(conversationProgress("exploring", o(0, 2), 2).hint, /Alex is still guarded/);
  assert.match(conversationProgress("exploring", o(3, 1), 2).hint, /Jordan is still guarded/);
});

test("hints follow the state and use no em dashes", () => {
  assert.match(conversationProgress("exploring", o(2, 2), 3).hint, /willing to try/);
  assert.match(conversationProgress("proposal_pending", o(2, 2), 3).hint, /who, what, when/);
  assert.match(conversationProgress("accepted_by_one", o(2, 2), 3).hint, /other/);
  for (const s of ["exploring", "proposal_pending", "accepted_by_one", "resolved"])
    assert.ok(!conversationProgress(s, o(1, 2), 2).hint.includes("—"));
});

test("a hostile run (openness stays 0) stays near empty", () => {
  assert.equal(conversationProgress("exploring", o(0, 0), 8).percent, 0);
});

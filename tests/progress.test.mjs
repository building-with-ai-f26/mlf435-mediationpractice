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
  // Guarded means below OPEN_ENOUGH (1): a resident at 0.
  assert.match(conversationProgress("exploring", o(0, 2), 2).hint, /Alex is still guarded/);
  assert.match(conversationProgress("exploring", o(3, 0), 2).hint, /Jordan is still guarded/);
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

import { turnLabel, createConfirmGate } from "../public/logic.js";
import { strengthsSummary, RUBRIC } from "../public/rubric.js";

test("turnLabel counts messages sent and nudges in the last two", () => {
  assert.equal(turnLabel(0, 15), "0 of 15 messages sent");
  assert.equal(turnLabel(5, 15), "5 of 15 messages sent");
  assert.match(turnLabel(13, 15), /^13 of 15 messages sent\. Time to wrap up\.$/);
  assert.match(turnLabel(14, 15), /wrap up/);
  assert.match(turnLabel(15, 15), /limit/);
  assert.match(turnLabel(99, 15), /^15 of 15/); // never above the cap
});

test("createConfirmGate needs a second press within the time, otherwise it arms again", () => {
  const g = createConfirmGate(4000);
  assert.equal(g.press(1000), "armed");
  assert.equal(g.press(3000), "confirmed");
  assert.equal(g.press(3500), "armed"); // used up: starts over
  assert.equal(g.press(9000), "armed"); // too late: armed again, not confirmed
  assert.equal(g.press(9500), "confirmed");
  g.press(20000); g.reset();
  assert.equal(g.press(20001), "armed");
});

test("strengthsSummary: met items with a quote, most votes first, then rubric order, at most n", () => {
  const combined = RUBRIC.map(q => ({ id: q.id, met: false, votes: 0, quote: "" }));
  const set = (id, votes, quote = "q") => { Object.assign(combined[id - 1], { met: true, votes, quote }); };
  set(5, 2); set(2, 3); set(9, 3); set(7, 3, ""); // 7 has no quote, so it is skipped
  const s = strengthsSummary(combined, 3);
  assert.deepEqual(s.map(x => x.id), [2, 9, 5]);
  assert.equal(s[0].text, RUBRIC[1].text);
  assert.deepEqual(strengthsSummary(combined.map(c => ({ ...c, met: false })), 3), []);
  assert.equal(strengthsSummary(combined, 1).length, 1);
});

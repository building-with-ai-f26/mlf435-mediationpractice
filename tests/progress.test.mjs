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

import { sidebarSignals } from "../public/logic.js";
const T0 = { addresses: "none", reflective_listening: false, validates_feeling: false, open_question: false, invites_to_share: false, ground_rules: false, proposes_solution: false, takes_side: false, lectures: false, proposal_on_table: false, plan_has_specifics: false };
const turn = (o = {}) => ({ tags: { ...T0, ...o } });

test("sidebarSignals: moods come from trust levels, and an empty session has no moves done", () => {
  const s = sidebarSignals([], { alex: 0, jordan: 3 });
  assert.deepEqual([s.moods.alex.label, s.moods.jordan.label], ["Guarded", "Ready to compromise"]);
  assert.equal(s.movesDone, 0);
  assert.equal(s.warning, null);
  assert.deepEqual(s.balance, { alex: 0, jordan: 0 });
  assert.equal(sidebarSignals([], { alex: 9, jordan: -2 }).moods.alex.level, 3); // clamped
  assert.equal(sidebarSignals([], {}).moods.jordan.label, "Guarded");
});

test("sidebarSignals: each move is credited to the right resident, 'both' counts for both, a failed tagger credits nothing", () => {
  const s = sidebarSignals([
    turn({ addresses: "both", ground_rules: true }),
    turn({ addresses: "alex", open_question: true, invites_to_share: true }),
    turn({ addresses: "alex", reflective_listening: true }),
    { tags: null },
    turn({ addresses: "jordan", validates_feeling: true }),
  ], { alex: 2, jordan: 1 });
  const done = Object.fromEntries(s.moves.map(m => [m.id, m.done]));
  assert.deepEqual(done, { ground_rules: true, invite_alex: true, invite_jordan: false, reflect_alex: true, reflect_jordan: true, plan: false, plan_specifics: false });
  assert.deepEqual(s.balance, { alex: 3, jordan: 2 }); // both + alex + alex for Alex; both + jordan for Jordan
  assert.equal(s.movesDone, 4);
});

test("sidebarSignals: plan moves, and warnings only for the latest message", () => {
  const plan = sidebarSignals([turn({ addresses: "both", proposal_on_table: true, plan_has_specifics: true })], { alex: 2, jordan: 2 });
  assert.equal(plan.moves.find(m => m.id === "plan").done && plan.moves.find(m => m.id === "plan_specifics").done, true);
  assert.match(sidebarSignals([turn({ addresses: "alex", takes_side: true })], { alex: 1, jordan: 0 }).warning, /taking a side/);
  assert.match(sidebarSignals([turn({ lectures: true })], {}).warning, /lecture/);
  assert.match(sidebarSignals([turn({ proposes_solution: true })], { alex: 0, jordan: 2 }).warning, /solution came before/);
  assert.equal(sidebarSignals([turn({ proposes_solution: true })], { alex: 2, jordan: 2 }).warning, null); // fine once both have some trust
  assert.equal(sidebarSignals([turn({ takes_side: true }), turn({ addresses: "both" })], {}).warning, null); // old slips are not repeated
});

import { residentCardState, shortQuote } from "../public/logic.js";
const PROFILE = { name: "Alex", mustHaves: ["quiet by 10:30"], flexible: ["weekends can run later"] };

test("shortQuote keeps whole words, adds an ellipsis only when cut, and copes with empty input", () => {
  assert.equal(shortQuote("Short one."), "Short one.");
  const long = "I really need the room quiet by half past ten on weeknights because my lab starts at seven and I cannot function on four hours of sleep";
  const q = shortQuote(long, 60);
  assert.ok(q.endsWith("...") && q.length <= 64 && !/\bwee\.\.\.$/.test(q));
  assert.equal(shortQuote(null), "");
  assert.equal(shortQuote("  lots   of   space  "), "lots of space");
});

test("residentCardState: needs unlock at trust 2, bending room at trust 3, and nothing is given away earlier", () => {
  const at = level => residentCardState({ resident: "alex", profile: PROFILE, level });
  assert.deepEqual([at(0).needs, at(0).flexible], [[], []]);
  assert.deepEqual([at(1).needs, at(1).flexible], [[], []]);
  assert.deepEqual([at(2).needs, at(2).flexible], [["quiet by 10:30"], []]);
  assert.deepEqual([at(3).needs, at(3).flexible], [["quiet by 10:30"], ["weekends can run later"]]);
  assert.equal(at(9).level, 3); // clamped
  assert.equal(at(-4).needsUnlocked, false);
});

test("residentCardState: the plan check shows only when a plan is on the table and the needs are unlocked", () => {
  const tags = { proposal_on_table: true, meets_needs: { alex: true, jordan: false } };
  assert.equal(residentCardState({ resident: "alex", profile: PROFILE, level: 2, lastTags: tags }).planFit, "fits");
  assert.equal(residentCardState({ resident: "jordan", profile: { ...PROFILE, name: "Jordan" }, level: 3, lastTags: tags }).planFit, "misses");
  assert.equal(residentCardState({ resident: "alex", profile: PROFILE, level: 1, lastTags: tags }).planFit, null); // locked: no hint
  assert.equal(residentCardState({ resident: "alex", profile: PROFILE, level: 3, lastTags: { ...tags, proposal_on_table: false } }).planFit, null);
  assert.equal(residentCardState({ resident: "alex", profile: PROFILE, level: 3, lastTags: null }).planFit, null);
});

test("residentCardState: trend, the last thing said, and a different suggested question at each trust level", () => {
  assert.equal(residentCardState({ resident: "alex", profile: PROFILE, level: 2, previousLevel: 1 }).trend, "warmer");
  assert.equal(residentCardState({ resident: "alex", profile: PROFILE, level: 0, previousLevel: 1 }).trend, "cooler");
  assert.equal(residentCardState({ resident: "alex", profile: PROFILE, level: 2, previousLevel: 2 }).trend, null);
  assert.equal(residentCardState({ resident: "alex", profile: PROFILE, level: 2 }).trend, null);
  assert.equal(residentCardState({ resident: "alex", profile: PROFILE, level: 0 }).said, null);
  assert.equal(residentCardState({ resident: "alex", profile: PROFILE, level: 0, lastText: "I am tired." }).said, "I am tired.");
  const asks = [0, 1, 2, 3].map(l => residentCardState({ resident: "alex", profile: PROFILE, level: l }).ask);
  assert.equal(new Set(asks.map(a => a.text)).size, 4);
  assert.ok(asks.every(a => a.text.startsWith("Alex,") && a.label.includes("Alex")));
});

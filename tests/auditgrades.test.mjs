import { test } from "node:test";
import assert from "node:assert/strict";
import { independentSignals, auditRecords, AUDITED } from "../tools/auditgrades.mjs";
import { RUBRIC } from "../public/rubric.js";

const tag = (o = {}) => ({ addresses: "none", reflective_listening: false, validates_feeling: false, open_question: false, invites_to_share: false, ground_rules: false, proposes_solution: false, takes_side: false, lectures: false, proposal_on_table: false, plan_has_specifics: false, ...o });
const rec = (lines, tags, answers) => ({
  persona: { id: "x" }, scenario: "noise",
  transcript: [{ sender: "Alex", text: "hi" }, ...lines.map(text => ({ sender: "Sam", text }))],
  openness: { turns: tags.map(t => ({ tags: t })) },
  graders: [1, 2, 3].map(i => ({ name: "g" + i, ok: true, answers: Object.fromEntries(RUBRIC.map(q => [q.id, { yes: !!answers[q.id], quote: answers[q.id] ? "q" : "" }])) })),
});

test("independentSignals reads the tagger's labels and plain text, per question", () => {
  const s = independentSignals(rec(
    ["Thanks for coming. Each of you will get a turn to speak. Let's take turns.", "Alex, what is going on? Jordan, how about you?", "Let's check in next Friday."],
    [tag({ addresses: "both", ground_rules: true }), tag({ addresses: "alex", open_question: true, reflective_listening: true }), tag({ addresses: "jordan", open_question: true, plan_has_specifics: true })], {}));
  assert.deepEqual([s[1], s[2], s[4], s[5], s[8], s[9], s[10], s[14], s[15]], [true, true, true, false, true, true, true, true, true]);
  const bad = independentSignals(rec(["You are wrong, Alex is right.", "Do it my way."], [tag({ takes_side: true }), tag({ lectures: true })], {}));
  assert.deepEqual([bad[8], bad[9], bad[10], bad[15]], [false, false, false, false]);
});

test("auditRecords counts agreement and the direction of each disagreement", () => {
  const good = rec(["Thanks. Each of you gets a turn.", "Let's agree on one at a time."], [tag({ addresses: "both", ground_rules: true })], { 1: true, 2: true });
  const harsh = rec(["Thanks. Each of you gets a turn.", "Let's agree on one at a time."], [tag({ addresses: "both", ground_rules: true })], { 1: true }); // graders say NO to Q2, signal says YES
  const a = auditRecords([good, harsh, { persona: { id: "y" } }]);
  assert.equal(a.sessions, 2);
  assert.equal(a.perQuestion[2].n, 2);
  assert.deepEqual([a.perQuestion[2].agree, a.perQuestion[2].gradersNoSignalYes, a.perQuestion[2].gradersYesSignalNo], [1, 1, 0]);
  assert.deepEqual(a.rows.map(r => [r.q, r.graders, r.signal]).filter(r => r[0] === 2), [[2, "NO", "YES"]]);
  assert.ok(AUDITED.includes(2));
});

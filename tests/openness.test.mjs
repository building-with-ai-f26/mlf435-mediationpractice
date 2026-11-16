import test from "node:test";
import assert from "node:assert/strict";
import { updateOpenness, startingOpenness, parseTags, buildTaggerPrompt } from "../public/logic.js";

const NONE = { addresses: "none", reflective_listening: false, validates_feeling: false, open_question: false, invites_to_share: false, ground_rules: false, proposes_solution: false, takes_side: false, lectures: false };
const tag = o => ({ ...NONE, ...o });
const st = (alex, jordan, progress = { alex: 0, jordan: 0 }) => ({ alex, jordan, progress });
const lv = s => [s.alex, s.jordan];

test("starting openness: 1 on easy, 0 on medium and hard", () => {
  assert.deepEqual(lv(startingOpenness("easy")), [1, 1]);
  assert.deepEqual(lv(startingOpenness("medium")), [0, 0]);
  assert.deepEqual(lv(startingOpenness("hard")), [0, 0]);
});

test("reflective listening raises the addressed resident by 1", () => {
  assert.deepEqual(lv(updateOpenness(st(1, 1), tag({ addresses: "alex", reflective_listening: true }), "medium")), [2, 1]);
  assert.deepEqual(lv(updateOpenness(st(1, 1), tag({ addresses: "jordan", reflective_listening: true }), "medium")), [1, 2]);
});

test("validating a feeling raises the addressed resident, and both for 'both'", () => {
  assert.deepEqual(lv(updateOpenness(st(0, 0), tag({ addresses: "both", validates_feeling: true }), "medium")), [1, 1]);
});

test("listening and validating together still give at most +1", () => {
  assert.deepEqual(lv(updateOpenness(st(0, 0), tag({ addresses: "alex", reflective_listening: true, validates_feeling: true }), "easy")), [1, 0]);
});

test("addressing nobody raises nobody", () => {
  assert.deepEqual(lv(updateOpenness(st(1, 1), tag({ reflective_listening: true }), "medium")), [1, 1]);
});

test("takes_side lowers the other resident", () => {
  assert.deepEqual(lv(updateOpenness(st(2, 2), tag({ addresses: "alex", takes_side: true }), "medium")), [2, 1]);
  assert.deepEqual(lv(updateOpenness(st(2, 2), tag({ addresses: "jordan", takes_side: true }), "medium")), [1, 2]);
});

test("lectures lowers the addressed resident (both if addressed to both)", () => {
  assert.deepEqual(lv(updateOpenness(st(2, 2), tag({ addresses: "jordan", lectures: true }), "medium")), [2, 1]);
  assert.deepEqual(lv(updateOpenness(st(2, 2), tag({ addresses: "both", lectures: true }), "medium")), [1, 1]);
});

test("proposes_solution lowers a resident below 2, but not one at 2 or more", () => {
  assert.deepEqual(lv(updateOpenness(st(1, 1), tag({ addresses: "alex", proposes_solution: true }), "medium")), [0, 1]);
  assert.deepEqual(lv(updateOpenness(st(2, 3), tag({ addresses: "both", proposes_solution: true }), "medium")), [2, 3]);
  assert.deepEqual(lv(updateOpenness(st(1, 2), tag({ addresses: "both", proposes_solution: true }), "medium")), [0, 2]);
});

test("a raise and a drop in the same turn add up", () => {
  assert.deepEqual(lv(updateOpenness(st(2, 2), tag({ addresses: "alex", reflective_listening: true, lectures: true }), "medium")), [2, 2]);
});

test("clamps to 0..3", () => {
  assert.deepEqual(lv(updateOpenness(st(3, 3), tag({ addresses: "both", reflective_listening: true }), "easy")), [3, 3]);
  assert.deepEqual(lv(updateOpenness(st(0, 0), tag({ addresses: "both", lectures: true }), "medium")), [0, 0]);
});

test("hard: two qualifying turns are needed for each +1", () => {
  let s = st(0, 0);
  const listen = tag({ addresses: "alex", reflective_listening: true });
  s = updateOpenness(s, listen, "hard");
  assert.deepEqual(lv(s), [0, 0]);
  assert.equal(s.progress.alex, 1);
  s = updateOpenness(s, listen, "hard");
  assert.deepEqual(lv(s), [1, 0]);
  assert.equal(s.progress.alex, 0);
  s = updateOpenness(s, listen, "hard");
  assert.deepEqual(lv(s), [1, 0]);
  s = updateOpenness(s, tag({ addresses: "alex", validates_feeling: true }), "hard");
  assert.deepEqual(lv(s), [2, 0]);
});

test("hard: progress is tracked per resident, and a drop wipes it", () => {
  let s = updateOpenness(st(1, 1), tag({ addresses: "both", validates_feeling: true }), "hard");
  assert.deepEqual(s.progress, { alex: 1, jordan: 1 });
  s = updateOpenness(s, tag({ addresses: "alex", lectures: true }), "hard");
  assert.deepEqual(lv(s), [0, 1]);
  assert.deepEqual(s.progress, { alex: 0, jordan: 1 });
});

test("easy and medium do not need two turns", () => {
  for (const d of ["easy", "medium"]) {
    assert.deepEqual(lv(updateOpenness(st(0, 0), tag({ addresses: "alex", reflective_listening: true }), d)), [1, 0]);
  }
});

test("unparseable tagger reply changes nothing", () => {
  const before = st(2, 1, { alex: 1, jordan: 0 });
  for (const raw of ["", "sorry, I cannot do that", "{not json", '{"addresses":"alex"}', '{"addresses":"nobody","reflective_listening":true}']) {
    assert.equal(parseTags(raw), null, raw);
    assert.deepEqual(updateOpenness(before, parseTags(raw), "hard"), before);
  }
});

test("updateOpenness does not mutate its input", () => {
  const before = st(1, 1);
  updateOpenness(before, tag({ addresses: "both", reflective_listening: true }), "hard");
  assert.deepEqual(before, st(1, 1));
});

test("parseTags accepts plain JSON and JSON inside a code fence", () => {
  const good = JSON.stringify(tag({ addresses: "both", open_question: true }));
  assert.deepEqual(parseTags(good), tag({ addresses: "both", open_question: true }));
  assert.deepEqual(parseTags("```json\n" + good + "\n```"), tag({ addresses: "both", open_question: true }));
});

test("tagger prompt contains the RA message and the recent conversation", () => {
  const p = buildTaggerPrompt([{ sender: "Alex", text: "I cannot sleep." }], "Alex, that sounds hard.");
  assert.ok(p.includes("Alex: I cannot sleep."));
  assert.ok(p.includes('"Alex, that sounds hard."'));
});

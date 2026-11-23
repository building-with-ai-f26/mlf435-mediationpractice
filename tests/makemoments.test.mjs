import { test } from "node:test";
import assert from "node:assert/strict";
import { classify, momentsFromRecord, pickMoments, mayHaveRealName, overlap, PER_KIND } from "../tools/makemoments.mjs";
import { KINDS, makeRng, validateMoment } from "../tools/modelbench.mjs";

test("the eight kinds", () => {
  assert.equal(KINDS.length, 8);
  assert.deepEqual(KINDS, ["good_open_question", "correct_paraphrase", "wrong_paraphrase", "takes_a_side", "jumps_to_solution", "specific_plan", "rude_or_rushed", "off_script_or_injection"]);
});

test("mayHaveRealName: skips names, emails and phone numbers, keeps fictional names and ordinary text", () => {
  assert.equal(mayHaveRealName("My roommate Maria is loud."), true);
  assert.equal(mayHaveRealName("email me at a@b.edu"), true);
  assert.equal(mayHaveRealName("call 212-555-0199"), true);
  assert.equal(mayHaveRealName("Alex, what has been going on? Jordan, how about you?"), false);
  assert.equal(mayHaveRealName("It sounds like Tuesday and Thursday are hard."), false);
});

test("classify: persona decides the adversarial kinds, tags decide the rest", () => {
  const base = { text: "x y z", tags: null, turn: 5, residentTexts: [] };
  assert.equal(classify({ ...base, persona: "injection" }).kind, "off_script_or_injection");
  assert.equal(classify({ ...base, persona: "side-taker" }).kind, "takes_a_side");
  assert.equal(classify({ ...base, persona: "solution-pusher" }).kind, "jumps_to_solution");
  assert.equal(classify({ ...base, persona: "hostile" }).kind, "rude_or_rushed");
  assert.equal(classify({ ...base, persona: "strong", tags: { proposal_on_table: true, plan_has_specifics: true } }).kind, "specific_plan");
  assert.equal(classify({ ...base, persona: "strong", turn: 2, tags: { open_question: true, invites_to_share: true, proposes_solution: false } }).kind, "good_open_question");
  assert.equal(classify({ ...base, persona: "strong", tags: {} }), null);
  const res = ["I need quiet after ten because my lab starts at seven and I cannot sleep."];
  assert.equal(classify({ ...base, persona: "strong", tags: { reflective_listening: true }, text: "So you need quiet after ten because your lab starts at seven.", residentTexts: res }).kind, "correct_paraphrase");
  const w = classify({ ...base, persona: "strong", tags: { reflective_listening: true }, text: "It sounds like parking is the real frustration for you.", residentTexts: res });
  assert.deepEqual(w, { kind: "wrong_paraphrase", auto: true });
  assert.ok(overlap("quiet after ten", res) > 0.5);
});

const rec = (over = {}) => ({
  persona: { id: "hostile" }, scenario: "noise", difficulty: "medium",
  transcript: [
    { sender: "Alex", text: "I'm Alex. The noise is a lot." }, { sender: "Jordan", text: "I'm Jordan. I study late." },
    { sender: "Sam", text: "Just stop it, both of you." }, { sender: "Alex", text: "Sam, that is not helpful." },
  ], openness: { turns: [{ tags: null }] }, ...over,
});

test("momentsFromRecord builds valid moments: RA last, resident named, dry and live records skipped, names skipped", () => {
  const ms = momentsFromRecord(rec(), "file-1");
  assert.equal(ms.length, 1);
  assert.deepEqual(validateMoment(ms[0]), []);
  assert.equal(ms[0].resident, "alex");
  assert.equal(ms[0].transcript.at(-1).sender, "RA");
  assert.equal(ms[0].kind, "rude_or_rushed");
  assert.deepEqual(momentsFromRecord(rec({ dry: true }), "f"), []);
  assert.deepEqual(momentsFromRecord(rec({ source: "live" }), "f"), []);
  const named = rec(); named.transcript[2].text = "Maria told me you two are fighting.";
  assert.deepEqual(momentsFromRecord(named, "f"), []);
});

test("pickMoments: capped, balanced over kinds, no duplicate RA lines", () => {
  const cands = [];
  for (const kind of KINDS) for (let i = 0; i < 9; i++) cands.push({ id: `${kind}-${i}`, kind, transcript: [{ sender: "RA", text: `line ${kind} ${i}` }] });
  cands.push({ ...cands[0], id: "dup" }); // same RA line as cands[0]
  const picked = pickMoments(cands, 40, makeRng(1));
  assert.equal(picked.length, 40);
  for (const k of KINDS) assert.ok(picked.filter(m => m.kind === k).length >= PER_KIND);
  assert.equal(new Set(picked.map(m => m.kind + m.transcript[0].text)).size, 40);
  assert.equal(pickMoments(cands, 10, makeRng(1)).length, 10);
});

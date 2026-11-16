import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RUBRIC, RUBRIC_VERSION, buildRubricPrompt, parseRubricReply, verifyEvidence,
  combineGraders, scoreFromCombined, coachingSummary,
} from "../public/rubric.js";

const history = [
  { sender: "Sam", text: "Thanks for coming. Each of you will get a turn to speak." },
  { sender: "Alex", text: "Jordan is so loud at night and I never sleep." },
  { sender: "Sam", text: "It sounds like you are exhausted, Alex." },
  { sender: "Jordan", text: "I only study late, I am doing my best." },
];

// Build a reply where the listed ids are YES with the given quote.
const reply = (yesIds, quote = "each of you will get a turn") =>
  RUBRIC.map(q => (yesIds.includes(q.id) ? `Q${q.id}: YES | ${quote}` : `Q${q.id}: NO`)).join("\n");
const grader = yesIds => ({ ok: true, answers: parseRubricReply(reply(yesIds)).answers });

test("rubric has 15 questions, ids 1..15, version 1", () => {
  assert.equal(RUBRIC_VERSION, 1);
  assert.deepEqual(RUBRIC.map(q => q.id), Array.from({ length: 15 }, (_, i) => i + 1));
  for (const q of RUBRIC) assert.ok(q.group && q.text && q.tip);
});

test("prompt labels the RA, lists 15 questions, has the rules, and no em dashes", () => {
  const p = buildRubricPrompt("Noise", "Medium", history, "Sam");
  assert.match(p, /^RA: Thanks for coming/m);
  assert.match(p, /^Alex: Jordan is so loud/m);
  assert.doesNotMatch(p, /Sam:/);
  for (let i = 1; i <= 15; i++) assert.match(p, new RegExp(`^Q${i}\\. `, "m"));
  assert.match(p, /Judge ONLY the RA/);
  assert.match(p, /unsure, answer NO/);
  assert.match(p, /No partial credit/);
  assert.doesNotMatch(p, /\u2014/);
  assert.doesNotMatch(JSON.stringify(RUBRIC), /\u2014/);
});

test("parses a clean reply", () => {
  const r = parseRubricReply(reply([1, 4]));
  assert.equal(r.ok, true);
  assert.deepEqual(r.answers[1], { yes: true, quote: "each of you will get a turn" });
  assert.equal(r.answers[2].yes, false);
});

test("parses a messy reply: bullets, bold, lowercase, quotes, extra text, duplicates", () => {
  const raw = [
    "Here are my answers:",
    "- Q1: yes | \"each of you will get a turn\"",
    "**Q2: NO**",
    "Q3. NO",
    "Q4 - YES | it sounds like you are exhausted",
    "Q5: NO",  "Q6: NO", "Q7: NO", "Q8: NO", "Q9: NO", "Q10: NO",
    "Q1: NO",
    "Q99: YES | nonsense",
  ].join("\n");
  const r = parseRubricReply(raw);
  assert.equal(r.ok, true);
  assert.deepEqual(r.answers[1], { yes: true, quote: "each of you will get a turn" });
  assert.equal(r.answers[4].yes, true);
  assert.equal(r.answers[11].yes, false); // missing line counts as NO
  assert.equal(r.answers[99], undefined);
});

test("ok is false with fewer than 10 parseable lines, true at exactly 10", () => {
  const lines = n => Array.from({ length: n }, (_, i) => `Q${i + 1}: NO`).join("\n");
  assert.equal(parseRubricReply(lines(9)).ok, false);
  assert.equal(parseRubricReply(lines(10)).ok, true);
  assert.equal(parseRubricReply("I cannot grade this.").ok, false);
  assert.equal(parseRubricReply(undefined).ok, false);
});

test("a YES with an invented quote becomes NO", () => {
  const a = parseRubricReply(reply([1], "welcome everyone to this meeting")).answers;
  const v = verifyEvidence(a, history);
  assert.equal(v.answers[1].yes, false);
  assert.deepEqual(v.changed, [1]);
});

test("a YES with an empty quote becomes NO", () => {
  const a = parseRubricReply("Q1: YES").answers;
  assert.deepEqual(verifyEvidence(a, history).changed, [1]);
});

test("a quote found only in a resident message becomes NO", () => {
  const a = parseRubricReply(reply([2], "I only study late")).answers;
  const v = verifyEvidence(a, history);
  assert.equal(v.answers[2].yes, false);
  assert.deepEqual(v.changed, [2]);
});

test("a real RA quote survives, ignoring case, spacing and curly quotes", () => {
  const h = [{ sender: "Sam", text: "I hear you,  it\u2019s tough. Each of you gets a turn." }];
  const a = parseRubricReply(reply([1, 6], "IT'S   tough")).answers;
  const v = verifyEvidence(a, h);
  assert.deepEqual(v.changed, []);
  assert.equal(v.answers[1].yes, true);
  assert.equal(v.answers[6].yes, true);
});

test("verifyEvidence does not change NO answers or mutate its input", () => {
  const a = parseRubricReply(reply([1], "nope")).answers;
  const copy = JSON.parse(JSON.stringify(a));
  const v = verifyEvidence(a, history);
  assert.deepEqual(a, copy);
  assert.deepEqual(v.changed, [1]);
});

test("voting with 3 valid graders needs 2 YES", () => {
  const c = combineGraders([grader([1, 2, 3]), grader([1, 2]), grader([1])]);
  assert.deepEqual([c[0].met, c[1].met, c[2].met], [true, true, false]);
  assert.equal(c[0].votes, 3);
  assert.equal(c[2].votes, 1);
  assert.equal(c[0].quote, "each of you will get a turn");
});

test("voting with 2 valid graders needs both; an invalid grader is ignored", () => {
  const bad = { ok: false, answers: parseRubricReply("garbage").answers };
  const c = combineGraders([grader([1, 2]), bad, grader([1])]);
  assert.equal(c[0].met, true);
  assert.equal(c[1].met, false);
});

test("voting with 1 valid grader: it decides", () => {
  const bad = { ok: false, answers: {} };
  const c = combineGraders([bad, grader([5]), bad]);
  assert.equal(c[4].met, true);
  assert.equal(c[0].met, false);
});

test("no valid graders: nothing is met", () => {
  const c = combineGraders([{ ok: false, answers: {} }]);
  assert.equal(c.some(x => x.met), false);
});

test("score math at 0, 8 and 15 met", () => {
  const mk = n => combineGraders([grader(Array.from({ length: n }, (_, i) => i + 1))]);
  assert.deepEqual(scoreFromCombined(mk(0)), { met: 0, total: 15, score: 0 });
  assert.deepEqual(scoreFromCombined(mk(8)), { met: 8, total: 15, score: 53 });
  assert.deepEqual(scoreFromCombined(mk(15)), { met: 15, total: 15, score: 100 });
});

test("coachingSummary lists missed questions in order and the first tip", () => {
  const c = combineGraders([grader([1, 3])]);
  const s = coachingSummary(c);
  assert.equal(s.missed.length, 13);
  assert.equal(s.missed[0].id, 2);
  assert.equal(s.nextTip, RUBRIC[1].tip);
  assert.deepEqual(coachingSummary(combineGraders([grader(RUBRIC.map(q => q.id))])), { missed: [], nextTip: null });
});

test("end to end: an RA who only said 'ok' scores 0 even if graders claim YES", () => {
  const h = [
    { sender: "Sam", text: "ok" },
    { sender: "Alex", text: "Jordan is so loud at night." },
    { sender: "Sam", text: "ok" },
    { sender: "Jordan", text: "I only study late." },
  ];
  // Every grader lies: YES on everything, quoting the residents or inventing text.
  const lies = RUBRIC.map(q => `Q${q.id}: YES | ${q.id % 2 ? "I only study late" : "let us set ground rules"}`).join("\n");
  const graded = [1, 2, 3].map(() => {
    const p = parseRubricReply(lies);
    return { ok: p.ok, answers: verifyEvidence(p.answers, h).answers };
  });
  const result = scoreFromCombined(combineGraders(graded));
  assert.deepEqual(result, { met: 0, total: 15, score: 0 });
});

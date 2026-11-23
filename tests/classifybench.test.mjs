import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArgs, loadCases, validateCase, runCase, summarize, questionTable, dryDeps } from "../tools/classifybench.mjs";
import { ROUTER_MODEL, TAGGER_MODEL, GRADER_MODELS } from "../public/config.js";
import { RUBRIC } from "../public/rubric.js";

const dir = t => new URL(`../labeled/${t}`, import.meta.url).pathname;
const router = loadCases(dir("router"), "router"), tagger = loadCases(dir("tagger"), "tagger"), grader = loadCases(dir("grader"), "grader");

test("5 router and 5 tagger example cases ship, flagged as examples; one grader template", () => {
  assert.equal(router.length, 5);
  assert.equal(tagger.length, 5);
  assert.equal(grader.length, 1);
  for (const c of [...router, ...tagger, ...grader]) assert.equal(c.example, true);
});

test("parseArgs: task required, default models per task come from config", () => {
  assert.throws(() => parseArgs([]), /--task/);
  assert.deepEqual(parseArgs(["--task", "router"]).models, [ROUTER_MODEL]);
  assert.deepEqual(parseArgs(["--task", "tagger"]).models, [TAGGER_MODEL]);
  assert.deepEqual(parseArgs(["--task", "grader"]).models, GRADER_MODELS.map(g => g.id));
  assert.equal(parseArgs(["--task", "router"]).dir, "labeled/router");
  assert.throws(() => parseArgs(["--task", "router", "--nope", "1"]), /Unknown flag/);
});

test("validateCase rejects bad labels", () => {
  assert.match(validateCase({ ...router[0], correct: "NOBODY" }, "router"), /correct/);
  assert.match(validateCase({ ...tagger[0], correct: {} }, "tagger"), /correct/);
  assert.match(validateCase({ ...grader[0], correct: { 1: true } }, "grader"), /Q1 to Q15/);
  assert.match(validateCase({ ...router[0], task: "tagger" }, "router"), /task/);
});

function sendFor(content, usage = { prompt_tokens: 10, completion_tokens: 5, cost: 0.001, completion_tokens_details: { reasoning_tokens: 7 } }) {
  return { send: async () => ({ status: 200, ok: true, data: { choices: [{ message: { content } }], usage } }), prices: {} };
}

test("router: agreement counted per case, unusable replies counted separately", async () => {
  const right = await runCase("router", router[0], "m/x", sendFor("alex."));
  assert.equal(right.agree, true);
  const wrong = await runCase("router", router[0], "m/x", sendFor("JORDAN"));
  assert.equal(wrong.agree, false);
  const junk = await runCase("router", router[0], "m/x", sendFor("I think maybe Alex"));
  assert.equal(junk.ok, false);
  const s = summarize([right, wrong, junk], ["m/x"])[0];
  assert.deepEqual([s.cases, s.usable, s.agree, s.unusable, s.agreement], [3, 2, 1, 1, "50%"]);
  assert.equal(s.reasoning_tokens, 7);
});

test("tagger: only the listed fields are checked", async () => {
  const reply = JSON.stringify({ addresses: "alex", reflective_listening: false, validates_feeling: false, open_question: true, invites_to_share: true, ground_rules: false, proposes_solution: false, takes_side: false, lectures: false });
  const r = await runCase("tagger", tagger[0], "m/x", sendFor(reply));
  assert.equal(r.agree, true);
  const bad = await runCase("tagger", tagger[2], "m/x", sendFor(reply));
  assert.equal(bad.agree, false);
  assert.match(bad.detail, /takes_side/);
});

test("grader: question by question against the hand score, quote rule applied", async () => {
  const c = grader[0];
  const quote = c.transcript.find(t => t.sender === "RA").text.split(" ").slice(0, 8).join(" ");
  const reply = RUBRIC.map(q => (c.correct[q.id] ? `Q${q.id}: YES | ${quote}` : `Q${q.id}: NO`)).join("\n");
  const same = await runCase("grader", c, GRADER_MODELS[0].id, sendFor(reply));
  assert.equal(same.same, 15);
  const noQuote = await runCase("grader", c, GRADER_MODELS[0].id, sendFor(RUBRIC.map(q => `Q${q.id}: YES | made up words nobody said`).join("\n")));
  assert.ok(noQuote.same < 15); // unsupported YES becomes NO, so it no longer matches the hand score
  const table = questionTable([same], [GRADER_MODELS[0].id]);
  assert.equal(table.length, 15);
  assert.equal(table[0].Q, "Q1");
});

test("--dry fake needs no key", async () => {
  const r = await runCase("router", router[2], "m/x", dryDeps());
  assert.equal(r.ok, true);
});

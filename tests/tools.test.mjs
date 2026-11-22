import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PERSONAS } from "../tools/personas.mjs";
import {
  parseArgs, transcriptPath, INDEX_HEADER, indexLine, assertNoSecret, safeWrite, costOf,
  newLedger, addToLedger, summarizeLedger, runOne, dryCall, BudgetError,
} from "../tools/simulate.mjs";
import { buildReport, personaOrder, formatReport, loadRecords, classifyChanges, missRates } from "../tools/report.mjs";

// No test may reach the network.
globalThis.fetch = () => { throw new Error("network call in a test"); };

const fixedNow = () => new Date(2026, 0, 5, 9, 3, 7);
const dryDeps = (extra = {}) => ({ call: dryCall, prices: {}, now: fixedNow, ...extra });
const run = (persona, extra) => runOne({ scenario: "noise", difficulty: "medium", persona: PERSONAS.find(p => p.id === persona), raModel: "deepseek/deepseek-chat" }, dryDeps(extra));

test("personas: ten of them with the required shape and table values", () => {
  const table = { strong: [8, 12, 15], "rushed-good": [8, 8, 11], average: [8, 5, 8], "solution-pusher": [8, 1, 4], "side-taker": [8, 0, 3], minimal: [3, 0, 2], "typo-good": [8, 10, 14], "nickname-both": [8, 8, 13], hostile: [6, 0, 2], injection: [6, null, null] };
  assert.deepEqual(PERSONAS.map(p => p.id), Object.keys(table));
  for (const p of PERSONAS) {
    assert.deepEqual(Object.keys(p).sort(), ["category", "expected", "id", "maxTurns", "systemPrompt"]);
    const [turns, min, max] = table[p.id];
    assert.equal(p.maxTurns, turns, p.id);
    assert.deepEqual(p.expected, min === null ? null : { min, max }, p.id);
    assert.match(p.systemPrompt, /1 to 3 sentences/);
    assert.match(p.systemPrompt, /Never mention that you are an AI/);
    assert.doesNotMatch(p.systemPrompt, /\u2014/);
  }
  assert.deepEqual([...new Set(PERSONAS.map(p => p.category))], ["Normal", "Messy", "Adversarial"]);
});

test("parseArgs: defaults, overrides, and clear errors", () => {
  const d = parseArgs([]);
  assert.deepEqual([d.scenario, d.difficulty, d.persona, d.runs, d.maxTurns, d.raModel, d.maxCost, d.out, d.dry], ["noise", "medium", "all", 1, 8, "deepseek/deepseek-chat", 1, "transcripts", false]);
  const a = parseArgs(["--scenario", "guest policy", "--difficulty", "hard", "--persona", "strong", "--runs", "3", "--max-cost", "0.25", "--out", "x", "--dry"]);
  assert.deepEqual([a.scenario, a.difficulty, a.persona, a.runs, a.maxCost, a.out, a.outGiven, a.dry], ["guest policy", "hard", "strong", 3, 0.25, "x", true, true]);
  for (const bad of [["--scenario", "pets"], ["--persona", "nobody"], ["--runs", "0"], ["--max-cost", "abc"], ["--nope", "1"], ["--runs"]]) {
    assert.throws(() => parseArgs(bad), Error, bad.join(" "));
  }
});

test("transcriptPath: YYYY-MM-DD/HHMMSS-scenario-difficulty-persona.json", () => {
  assert.equal(transcriptPath(fixedNow(), "guest policy", "hard", "rushed-good"), "2026-01-05/090307-guest-policy-hard-rushed-good.json");
});

test("index line matches the header and leaves unknown cost and failed graders blank", async () => {
  const rec = await run("strong");
  const line = indexLine(rec, "2026-01-05/x.json");
  assert.equal(line.split(",").length, INDEX_HEADER.split(",").length);
  assert.ok(line.startsWith("2026-01-05,2026-01-05/x.json,noise,medium,strong,"));
  rec.graders[1].ok = false;
  rec.cost.graders.usd = null;
  const cells = indexLine(rec, "f.json").split(",");
  assert.equal(cells[INDEX_HEADER.split(",").indexOf("claude_met")], "");
  assert.equal(cells[INDEX_HEADER.split(",").indexOf("cost_graders")], "");
});

test("files containing sk-or- are refused and nothing is written", () => {
  assert.throws(() => assertNoSecret("hello sk-or-v1-abc"), /sk-or-/);
  assert.throws(() => assertNoSecret("the key is SECRETVALUE123", "SECRETVALUE123"), /key/);
  assert.doesNotThrow(() => assertNoSecret("clean text"));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sim-"));
  const f = path.join(dir, "a", "b.json");
  assert.throws(() => safeWrite(f, '{"x":"sk-or-v1-zzz"}'), /sk-or-/);
  assert.equal(fs.existsSync(f), false);
  safeWrite(f, "{}");
  assert.equal(fs.readFileSync(f, "utf8"), "{}");
  safeWrite(f, "1", { append: true });
  assert.equal(fs.readFileSync(f, "utf8"), "{}1");
  assert.throws(() => safeWrite(f, "sk-or-x", { append: true }), /sk-or-/);
});

test("costOf prefers usage.cost, falls back to prices.json, else null", () => {
  assert.equal(costOf("m", { cost: 0.01, prompt_tokens: 5 }, {}), 0.01);
  const prices = { m: { prompt_per_million: 1, completion_per_million: 2 } };
  assert.equal(costOf("m", { prompt_tokens: 1e6, completion_tokens: 5e5 }, prices), 2);
  assert.equal(costOf("m", { prompt_tokens: 10 }, { m: { prompt_per_million: null, completion_per_million: null } }), null);
  assert.equal(costOf("other", { prompt_tokens: 10 }, prices), null);
  assert.equal(costOf("m", undefined, prices), null);
});

test("ledger: sums known costs, marks a role unknown if any call was unknown", () => {
  const l = newLedger();
  addToLedger(l, "residents", { prompt_tokens: 10, completion_tokens: 5, completion_tokens_details: { reasoning_tokens: 2 } }, 0.5);
  addToLedger(l, "residents", { prompt_tokens: 1, completion_tokens: 1 }, 0.25);
  addToLedger(l, "graders", { prompt_tokens: 4, completion_tokens: 4 }, 0.1);
  addToLedger(l, "ra_sim", { prompt_tokens: 1, completion_tokens: 1 }, null);
  const { usage, cost } = summarizeLedger(l);
  assert.deepEqual(usage.residents, { calls: 2, prompt_tokens: 11, completion_tokens: 6, reasoning_tokens: 2 });
  assert.deepEqual(cost.residents, { usd: 0.75, known: true });
  assert.deepEqual(cost.ra_sim, { usd: null, known: false });
  assert.equal(cost.user_session.usd, 0.85);
  assert.deepEqual(cost.total, { usd: null, known: false });
});

test("dry session: full record, persona turn limit wins, no secrets, no network", async () => {
  const rec = await run("minimal");
  assert.equal(rec.schemaVersion, 1);
  assert.equal(rec.persona.maxTurns, 3);
  assert.equal(rec.transcript.length, 2 + 3 * 2);
  assert.deepEqual(rec.transcript.map(t => t.sender).slice(0, 2), ["Alex", "Jordan"]);
  assert.ok(rec.transcript.every(t => !Number.isNaN(Date.parse(t.at))));
  assert.equal(rec.rubricVersion, 1);
  assert.equal(rec.graders.length, 3);
  assert.equal(rec.combined.length, 15);
  assert.equal(rec.result.total, 15);
  assert.equal(rec.cost.user_session.known, true);
  assert.doesNotMatch(JSON.stringify(rec), /sk-or-/);
  const strong = await run("strong");
  assert.equal(strong.transcript.length, 2 + 8 * 2);
});

test("a grader that returns junk is recorded as failed and the others still score", async () => {
  const call = async a => (a.role === "graders" && a.model.startsWith("anthropic") ? { content: "I cannot do that", finishReason: "stop", usage: {} } : dryCall(a));
  const rec = await run("strong", { call });
  const claude = rec.graders.find(g => g.name === "Claude");
  assert.equal(claude.ok, false);
  assert.match(claude.error, /could not be read/);
  assert.equal(rec.graders.filter(g => g.ok).length, 2);
  assert.equal(typeof rec.result.met, "number");
});

test("no valid grader gives a null score, not zero", async () => {
  const call = async a => (a.role === "graders" ? { content: "nope", finishReason: "stop", usage: {} } : dryCall(a));
  assert.equal((await run("strong", { call })).result.score, null);
});

test("budget: the run stops before the next call once the limit is passed", async () => {
  let calls = 0, total = 0;
  const deps = dryDeps({
    call: async a => { calls++; const r = await dryCall(a); r.usage.cost = 0.6; return r; },
    before() { if (total > 1) throw new BudgetError("over"); },
    after(c) { total += c; },
  });
  await assert.rejects(runOne({ scenario: "noise", difficulty: "easy", persona: PERSONAS[0], raModel: "x" }, deps), BudgetError);
  assert.equal(calls, 2);
  assert.ok(total > 1);
});

// ----- report math, from hand-made fixtures -----
const fx = (id, met, graderMets, answersByGrader, cost, changed = [0, 0, 0]) => ({
  schemaVersion: 1, persona: { id }, result: { met },
  graders: ["DeepSeek", "Claude", "Gemini"].map((name, i) => ({ name, ok: graderMets[i] !== null, metCount: graderMets[i], changed: Array.from({ length: changed[i] }, (_, k) => k + 1), answers: answersByGrader[i] })),
  cost,
});
const ans = yesIds => Object.fromEntries(Array.from({ length: 15 }, (_, i) => [i + 1, { yes: yesIds.includes(i + 1), quote: "" }]));
const cost = (r, s, g) => ({ residents: { usd: r, known: r !== null }, ra_sim: { usd: s, known: s !== null }, graders: { usd: g, known: g !== null }, user_session: { usd: r !== null && g !== null ? r + g : null, known: r !== null && g !== null } });

test("report: means, ranges, ordering, changed count, disagreement and cost", () => {
  const recs = [
    fx("strong", 14, [14, 15, 13], [ans([1, 2, 3]), ans([1, 2, 3]), ans([1, 2, 3])], cost(0.02, 0.01, 0.03), [1, 0, 2]),
    fx("strong", 12, [12, 12, 12], [ans([1, 2]), ans([1, 2, 4]), ans([1, 2])], cost(0.04, 0.03, 0.05), [0, 0, 1]),
    fx("minimal", 0, [0, 1, null], [ans([]), ans([5]), {}], cost(null, 0.01, 0.01)),
  ];
  const rep = buildReport(recs);
  assert.deepEqual(rep.ids, ["strong", "minimal"]);
  const s = rep.scores.find(x => x.persona === "strong");
  assert.deepEqual([s.n, s.mean, s.min, s.max, s.inRange], [2, 13, 12, 14, true]);
  assert.equal(rep.scores.find(x => x.persona === "minimal").inRange, true);
  assert.equal(rep.graderMeans.find(g => g.grader === "Claude").byPersona.strong, 13.5);
  assert.equal(rep.graderMeans.find(g => g.grader === "Gemini").byPersona.minimal, null);
  assert.deepEqual(rep.changed.map(c => c.changedYesToNo), [1, 0, 3]);
  // strong #1: no disagreement. strong #2: Q4 differs. minimal: 2 valid graders, Q5 differs. 15 questions each.
  assert.deepEqual(rep.disagreement, { asked: 45, disagreed: 2, share: 2 / 45 });
  assert.equal(rep.cost.residents.sessions, 2);
  assert.equal(rep.cost.residents.unknown, 1);
  assert.ok(Math.abs(rep.cost.residents.mean - 0.03) < 1e-9);
  assert.ok(Math.abs(rep.cost.user_session.mean - 0.07) < 1e-9);
  assert.ok(Math.abs(rep.cost.ra_sim.mean - (0.05 / 3)) < 1e-9);
  assert.match(formatReport(rep), /user session \(residents \+ graders, no ra_sim\)/);
});

test("report ordering follows the expected ranges, injection last", () => {
  const o = personaOrder();
  assert.equal(o[0], "strong");
  assert.equal(o.at(-1), "injection");
  assert.ok(o.indexOf("strong") < o.indexOf("rushed-good") && o.indexOf("rushed-good") < o.indexOf("average"));
});

test("report reads files, skips dry records unless asked, and handles an empty folder", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rep-"));
  fs.mkdirSync(path.join(dir, "2026-01-05"));
  fs.writeFileSync(path.join(dir, "2026-01-05", "a.json"), JSON.stringify({ schemaVersion: 1, persona: { id: "strong" } }));
  fs.writeFileSync(path.join(dir, "2026-01-05", "b.json"), JSON.stringify({ schemaVersion: 1, dry: true, persona: { id: "strong" } }));
  fs.writeFileSync(path.join(dir, "2026-01-05", "junk.json"), "not json");
  assert.equal(loadRecords(dir).length, 1);
  assert.equal(loadRecords(dir, { includeDry: true }).length, 2);
  assert.equal(formatReport(buildReport([])), "No transcripts found.");
  assert.deepEqual(loadRecords(path.join(dir, "missing")), []);
});

// ----- changed-YES reasons and per-question miss rates -----
test("report: classifies each changed YES and counts misses per question", () => {
  const transcript = [
    { sender: "Alex", text: "What can we do about the noise?" },
    { sender: "Sam", text: "Let's set ground rules, one person speaks at a time." },
  ];
  const raw = [
    "Q1: YES",                                                   // no_quote
    "Q2: YES | let's set ground rules one person speaks at a time", // punctuation only: still not an exact match
    "Q3: YES | What can we do about the noise",                  // resident words
    "Q4: YES | invented sentence here",                          // not found
    "Q5: NO", "Q6: NO", "Q7: NO", "Q8: NO", "Q9: NO", "Q10: NO", "Q11: NO", "Q12: NO", "Q13: NO", "Q14: NO", "Q15: NO",
  ].join("\n");
  const rec = { schemaVersion: 1, persona: { id: "strong" }, transcript, result: { met: 0 }, combined: Array.from({ length: 15 }, (_, i) => ({ id: i + 1, met: i === 1 })),
    graders: [{ name: "DeepSeek", ok: true, raw, metCount: 0, changed: [], answers: {} }] };
  const kinds = Object.fromEntries(classifyChanges([rec]).map(c => [c.q, c.kind]));
  assert.deepEqual(kinds, { 1: "no_quote", 2: "punctuation_only", 3: "resident_words", 4: "not_found" });
  const m = missRates([rec]);
  assert.equal(m.length, 15);
  assert.deepEqual([m[0].missed, m[1].missed, m[0].share], [1, 0, 1]);
});

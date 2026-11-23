import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArgs, validateMoment, loadMoments, residentPrompt, parseGraderReply, buildGraderPrompt, makeRng, shuffle, runBench, scoreboard, auditMatch, bestModels, dryDeps, KINDS, DEFAULT_MODELS } from "../tools/modelbench.mjs";

const moments = loadMoments(new URL("../moments", import.meta.url).pathname);
const MODELS = ["m/one", "m/two", "m/three"];

// Fake model. Residents echo their model id. Graders read the labelled replies and score by model id,
// so the "best" model is known: m/two > m/one > m/three. No network, no key.
function fakeDeps({ failGrader = null, cost = 0.01 } = {}) {
  const calls = [];
  return {
    calls, prices: {}, rng: makeRng(7),
    send: async body => {
      calls.push(body);
      const prompt = body.messages[0].content;
      const usage = { prompt_tokens: 10, completion_tokens: 5, cost, prompt_tokens_details: { cached_tokens: 3 } };
      if (prompt.includes("Return JSON only")) {
        if (body.model === failGrader) return { status: 200, ok: true, data: { choices: [{ message: { content: "no json here" } }], usage } };
        const rank = { "m/two": 5, "m/one": 4, "m/three": 2 };
        const scores = {};
        for (const m of prompt.matchAll(/<<<REPLY ([A-E])\n(.*)\nREPLY/g)) {
          const r = rank[m[2].match(/m\/\w+/)[0]];
          scores[m[1]] = { voice: r, consistency: r, reaction: r, does_not_do_the_RAs_job: r, serious_mistakes: m[2].includes("m/three") ? ["breaks_character"] : [] };
        }
        return { status: 200, ok: true, data: { choices: [{ message: { content: "```json\n" + JSON.stringify({ scores }) + "\n```" } }], usage } };
      }
      return { status: 200, ok: true, data: { choices: [{ message: { content: `Yeah I hear that, ${body.model}.` } }], usage } };
    },
  };
}
const run = (deps, extra = {}) => runBench({ moments, models: MODELS, graders: ["a/g1", "b/g2"], auditGrader: "c/g3", maxCost: 10, auditReplies: 40, ...extra }, deps);

test("the 3 example moments are valid", () => {
  assert.equal(moments.length, 3);
  for (const m of moments) assert.ok(KINDS.includes(m.kind));
});

test("validateMoment rejects bad kind, resident and a transcript not ending with the RA", () => {
  const ok = { ...moments[0] };
  assert.deepEqual(validateMoment(ok), []);
  assert.ok(validateMoment({ ...ok, kind: "nope" }).length);
  assert.ok(validateMoment({ ...ok, resident: "sam" }).length);
  assert.ok(validateMoment({ ...ok, transcript: [{ sender: "Alex", text: "hi" }] }).length);
});

test("parseArgs: models, two graders from different vendors, defaults", () => {
  const a = parseArgs(["--models", "x/a,y/b"]);
  assert.deepEqual(a.models, ["x/a", "y/b"]);
  assert.equal(a.graders.length, 2);
  assert.deepEqual(parseArgs([]).models, DEFAULT_MODELS);
  assert.deepEqual(DEFAULT_MODELS, ["anthropic/claude-haiku-5.5", "openai/gpt-6-luna", "deepseek/deepseek-v4.1-flash", "anthropic/claude-sonnet-5.5"]);
  assert.throws(() => parseArgs(["--models", "a/1,b/2,c/3,d/4,e/5,f/6"]), /--models/);
  assert.throws(() => parseArgs(["--models", "x/a", "--graders", "g/1,g/2"]), /different vendors/);
  assert.throws(() => parseArgs(["--models", "x/a", "--bogus", "1"]), /Unknown flag/);
});

test("residentPrompt uses the app's mediation prompt for the right resident", () => {
  const p = residentPrompt(moments[1]).prompt; // jordan
  assert.match(p, /^You are Jordan\./);
  assert.match(p, /CONVERSATION:/);
  assert.match(p, /RA: What if on weeknights/);
});

test("parseGraderReply reads fenced JSON, drops bad labels and unknown tags", () => {
  const raw = "```json\n" + JSON.stringify({ scores: {
    A: { voice: 4, consistency: 3, reaction: 5, does_not_do_the_RAs_job: 2, serious_mistakes: ["leaks_prompt", "made_up"] },
    B: { voice: 9, consistency: 3, reaction: 5, does_not_do_the_RAs_job: 2 },
  } }) + "\n```";
  const r = parseGraderReply(raw, ["A", "B"]);
  assert.ok(r.ok);
  assert.deepEqual(Object.keys(r.scores), ["A"]);
  assert.deepEqual(r.scores.A.mistakes, ["leaks_prompt"]);
  assert.equal(parseGraderReply("sorry", ["A"]).ok, false);
});

test("grader prompts never contain the names of the models under test or the other grader", async () => {
  const deps = fakeDeps();
  const send = deps.send;
  // Residents reply without naming themselves, so any model id in a grader prompt would be a leak.
  deps.send = async body => {
    const r = await send(body);
    if (!body.messages[0].content.includes("Return JSON only")) r.data.choices[0].message.content = `Okay, fine, ${body.model.length} things to say.`;
    return r;
  };
  await run(deps);
  const graderCalls = deps.calls.filter(b => b.messages[0].content.includes("Return JSON only"));
  assert.equal(graderCalls.length, 9);
  for (const b of graderCalls) assert.doesNotMatch(b.messages[0].content, /m\/(one|two|three)|a\/g1|b\/g2|c\/g3/);
});

test("shuffle is seeded and keeps every item", () => {
  const a = shuffle([1, 2, 3, 4, 5], makeRng(1)), b = shuffle([1, 2, 3, 4, 5], makeRng(1));
  assert.deepEqual(a, b);
  assert.deepEqual([...a].sort(), [1, 2, 3, 4, 5]);
});

test("full run with the fake model: scoreboard, mistakes, cost, cache, audit", async () => {
  const deps = fakeDeps();
  const res = await run(deps);
  assert.equal(res.stopped, null);
  assert.equal(res.replies.length, 9);
  assert.equal(res.gradings.length, 6); // 3 moments x 2 graders
  assert.equal(res.audits.length, 3);
  const board = Object.fromEntries(scoreboard(res, MODELS).map(r => [r.model, r]));
  assert.equal(board["m/two"].mean_score, 5);
  assert.equal(board["m/one"].mean_score, 4);
  assert.equal(board["m/three"].mean_score, 2);
  assert.equal(board["m/three"].serious_mistakes, 3);
  assert.equal(board["m/two"].serious_mistakes, 0);
  assert.equal(board["m/two"].cents_per_reply, 1);
  assert.equal(board["m/two"].cache_hits, 9);
  assert.equal(auditMatch(res, MODELS).share, 1);
});

test("graders see the replies under labels A to E, in a shuffled order that varies", async () => {
  const deps = fakeDeps();
  const res = await run(deps);
  const orders = res.gradings.map(g => Object.keys(g.labelToModel).map(l => g.labelToModel[l]).join(","));
  assert.ok(new Set(orders).size > 1, "expected at least two different orders");
  for (const g of res.gradings) assert.deepEqual(Object.keys(g.labelToModel), ["A", "B", "C"]);
});

test("a grader with unreadable output is skipped, not fatal", async () => {
  const res = await run(fakeDeps({ failGrader: "a/g1" }));
  assert.equal(res.gradings.filter(g => !g.ok).length, 3);
  const board = scoreboard(res, MODELS);
  assert.equal(board.find(r => r.model === "m/two").mean_score, 5); // from g2 alone
});

test("--max-cost stops the run and keeps what finished", async () => {
  const res = await run(fakeDeps({ cost: 0.05 }), { maxCost: 0.12 });
  assert.match(res.stopped, /over --max-cost/);
  assert.ok(res.replies.length < 9 || res.gradings.length < 6);
  assert.ok(res.cost.usd > 0.12 && res.cost.usd < 0.5);
});

test("a failed model call is recorded and the other models still run", async () => {
  const deps = fakeDeps();
  const send = deps.send;
  deps.send = async b => (b.model === "m/one" && !b.messages[0].content.includes("Return JSON only") ? { status: 500, ok: false, data: { error: { message: "boom" } } } : send(b));
  const res = await run(deps);
  assert.equal(res.replies.filter(r => r.error).length, 3);
  assert.equal(scoreboard(res, MODELS).find(r => r.model === "m/one").failed, 3);
});

test("request bodies carry the app's resident settings and no provider field (the sender adds zdr)", async () => {
  const deps = fakeDeps();
  await run(deps);
  const first = deps.calls[0];
  assert.equal(first.max_tokens, 150);
  assert.deepEqual(first.reasoning, { enabled: false });
  assert.equal(first.provider, undefined);
});

test("an empty reply names the finish reason", async () => {
  const deps = fakeDeps();
  const send = deps.send;
  deps.send = async b => {
    if (b.model !== "m/one" || b.messages[0].content.includes("Return JSON only")) return send(b);
    return { status: 200, ok: true, data: { choices: [{ message: { content: null }, finish_reason: "length" }], usage: {} } };
  };
  const res = await run(deps);
  assert.match(res.replies.find(r => r.model === "m/one").error, /finish_reason: length/);
});

test("bestModels keeps ties", () => {
  assert.deepEqual(bestModels({ a: 4, b: 4, c: 3, d: null }).sort(), ["a", "b"]);
});

test("--dry fake needs no key and produces a scoreboard", async () => {
  const res = await run(dryDeps(makeRng(1)));
  assert.ok(scoreboard(res, MODELS).every(r => r.mean_score !== null));
});

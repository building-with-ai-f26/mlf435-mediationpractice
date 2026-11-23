import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { RESIDENT_MODEL, GRADER_MODELS, TOKENS_RESIDENT, TOKENS_GRADER, GRADER_OPTS, MAX_TURNS, TAGGER_MODEL, TAGGER_OPTS, ROUTER_MODEL, ROUTER_OPTS, getProfiles, createSession } from "../public/config.js";

test("every model id is on the server allowlist, which is built from config.js", () => {
  const src = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");
  assert.match(src, /new Set\(allModelIds\(\)\)/);
  const ids = allModelIds();
  for (const id of [RESIDENT_MODEL, ...GRADER_MODELS.map(g => g.id), TAGGER_MODEL, ROUTER_MODEL]) assert.ok(ids.includes(id), `${id} missing from allModelIds`);
  assert.equal(GRADER_MODELS.length, 3);
  // Three different vendors.
  assert.equal(new Set(GRADER_MODELS.map(g => g.id.split("/")[0])).size, 3);
});

test("default models: Haiku residents, router and tagger; Claude, Gemini and GPT graders", () => {
  assert.deepEqual(DEFAULT_GRADER_MODELS, ["anthropic/claude-haiku-5.5", "google/gemini-3.6-flash", "openai/gpt-6-luna"]);
  assert.equal(resolveModelId(undefined, "a/b"), "a/b");
  assert.equal(resolveModelId("x/y", "a/b"), "x/y");
  assert.equal(resolveModelId("bad id", "a/b"), "a/b");
  // Gemini cannot turn reasoning off; the others can.
  assert.deepEqual(graderOpts(GRADER_MODELS[1]).reasoning, { effort: "low" });
  assert.deepEqual(graderOpts(GRADER_MODELS[0]).reasoning, { enabled: false });
  assert.equal(graderOpts(GRADER_MODELS[2]).temperature, 0);
});

test("applyServerModels takes ids from /config.json and ignores junk", () => {
  const before = JSON.stringify(modelConfig());
  applyServerModels({ residentModel: "bad id", graderModels: ["junk"], taggerModel: 5 });
  assert.equal(JSON.stringify(modelConfig()), before);
});


test("token and turn constants keep their values", () => {
  assert.equal(TOKENS_RESIDENT, 150);
  assert.equal(TOKENS_GRADER, 1500);
  assert.deepEqual(GRADER_OPTS, { maxTokens: 1500, temperature: 0, reasoning: { enabled: false } });
  assert.equal(MAX_TURNS, 15);
});

test("createSession returns a fresh object with the starting fields each time", () => {
  const a = createSession();
  assert.deepEqual(a, {
    raName: "", topic: "noise", difficulty: "medium",
    turnHistory: [], active: false, lastSpeaker: "Jordan", turnCount: 0,
    resolved: false, resolvedTurn: null,
    openness: { alex: 0, jordan: 0, progress: { alex: 0, jordan: 0 } },
  });
  a.turnHistory.push({ sender: "x", text: "y" });
  assert.deepEqual(createSession().turnHistory, []);
});

test("getProfiles covers every topic and difficulty, and falls back for unknown ones", () => {
  for (const topic of ["noise", "cleaning", "guest policy", "hygiene", "shared items", "religious practice"]) {
    for (const d of ["easy", "medium", "hard"]) {
      const p = getProfiles(topic, d);
      assert.ok(p.alex.stance && p.jordan.stance && p.alex.mood && p.jordan.mood);
    }
  }
  assert.deepEqual(getProfiles("nope", "nope"), getProfiles("noise", "medium"));
});

test("tagger uses Haiku with the grader's low-reasoning, temperature 0 settings and a small budget", () => {
  assert.equal(TAGGER_MODEL, "anthropic/claude-haiku-5.5");
  assert.deepEqual(TAGGER_OPTS, { maxTokens: 220, temperature: 0, reasoning: { enabled: false } });
  assert.ok(allModelIds().includes(TAGGER_MODEL));
});

test("religious practice profile uses only the given facts and keeps both residents respectful", () => {
  const p = getProfiles("religious practice", "hard");
  assert.match(p.alex.stance, /Muslim/);
  assert.match(p.alex.stance, /prays quietly each night after Jordan goes to sleep/);
  assert.match(p.alex.stance, /halal/);
  assert.match(p.alex.stance, /few weeks/);
  assert.match(p.alex.stance, /does not want tension/);
  assert.match(p.alex.stance, /gives Alex space to share/);
  assert.match(p.jordan.stance, /openly keeps bacon in the shared fridge/);
  assert.match(p.alex.stance, /respectful/);
  assert.match(p.jordan.stance, /respectful/);
  assert.notDeepEqual(p, getProfiles("noise", "hard"));
});

test("setup list offers religious practice and the server-free topic list matches the profiles", () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(html, /<option value="religious practice">Religious Practice<\/option>/);
  assert.equal((html.match(/<option value="[a-z ]+">[^<]*(Complaint|Dispute|Violation|Concern|Conflict|Practice)<\/option>/g) || []).length, 6);
});

test("router settings, and the router model is on the server allowlist", () => {
  assert.equal(ROUTER_MODEL, "anthropic/claude-haiku-5.5");
  assert.deepEqual(ROUTER_OPTS, { maxTokens: 30, temperature: 0, reasoning: { enabled: false } });
  assert.ok(allModelIds().includes(ROUTER_MODEL));
});

import { resolveResidentModel, DEFAULT_RESIDENT_MODEL, RESIDENT_OPTS, allModelIds, DEFAULT_GRADER_MODELS, resolveModelId, graderOpts, applyServerModels, modelConfig } from "../public/config.js";
import { zdrRefusalMessage } from "../chatBody.mjs";

test("resident model: default is Haiku, env value used when well formed, junk falls back to the default", () => {
  assert.equal(DEFAULT_RESIDENT_MODEL, "anthropic/claude-haiku-5.5");
  assert.equal(resolveResidentModel(undefined), DEFAULT_RESIDENT_MODEL);
  assert.equal(resolveResidentModel(""), DEFAULT_RESIDENT_MODEL);
  assert.equal(resolveResidentModel("deepseek/deepseek-chat"), "deepseek/deepseek-chat");
  assert.equal(resolveResidentModel(" meta-llama/llama-3.3-70b-instruct "), "meta-llama/llama-3.3-70b-instruct");
  assert.equal(resolveResidentModel("not a model; rm -rf"), DEFAULT_RESIDENT_MODEL);
  assert.deepEqual(RESIDENT_OPTS, { maxTokens: TOKENS_RESIDENT, reasoning: { enabled: false } });
});

test("zdr refusal: the no endpoints error gets a clear message naming the model; other errors are left alone", () => {
  const m = zdrRefusalMessage("x/y", "No endpoints found matching your data policy (Zero data retention). Configure: https://openrouter.ai/settings/privacy");
  assert.match(m, /x\/y/);
  assert.match(m, /no zero data retention route/);
  assert.equal(zdrRefusalMessage("x/y", "Rate limited"), null);
  assert.equal(zdrRefusalMessage("x/y", undefined), null);
});

import { REASONING, REASONING_LOWEST } from "../public/config.js";
import { buildRequestBody } from "../public/logic.js";
import { buildOpenRouterBody } from "../chatBody.mjs";

test("one reasoning setting: residents, router, tagger and graders all use it; only a model that cannot turn it off uses the lowest", () => {
  assert.deepEqual(REASONING, { enabled: false });
  for (const opts of [RESIDENT_OPTS, ROUTER_OPTS, TAGGER_OPTS, GRADER_OPTS]) assert.equal(opts.reasoning, REASONING);
  assert.equal(graderOpts(GRADER_MODELS[0]).reasoning, REASONING);
  assert.equal(graderOpts(GRADER_MODELS[2]).reasoning, REASONING);
  assert.equal(graderOpts(GRADER_MODELS[1]).reasoning, REASONING_LOWEST);
  // It reaches the request body, and the server adds zero data retention on top of it.
  const body = buildOpenRouterBody(buildRequestBody("m/x", [{ role: "user", content: "hi" }], RESIDENT_OPTS), {});
  assert.deepEqual(body.reasoning, { enabled: false });
  assert.deepEqual(body.provider, { zdr: true, data_collection: "deny" });
});

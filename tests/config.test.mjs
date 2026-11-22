import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MAIN_MODEL, GRADER_MODELS, TOKENS_RESIDENT, TOKENS_GRADER, GRADER_OPTS, MAX_TURNS, TAGGER_MODEL, TAGGER_OPTS, ROUTER_MODEL, ROUTER_OPTS, getProfiles, createSession } from "../public/config.js";

test("every model id is on the server allowlist", () => {
  const src = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");
  for (const id of [MAIN_MODEL, ...GRADER_MODELS.map(g => g.id)]) {
    assert.ok(src.includes(`"${id}"`), `${id} missing from ALLOWED_MODELS`);
  }
  assert.equal(GRADER_MODELS.length, 3);
});

test("token and turn constants keep their values", () => {
  assert.equal(TOKENS_RESIDENT, 150);
  assert.equal(TOKENS_GRADER, 1500);
  assert.deepEqual(GRADER_OPTS, { maxTokens: 1500, temperature: 0, reasoning: { enabled: false } });
  assert.equal(MAX_TURNS, 10);
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
  const src = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");
  assert.ok(src.includes(`"${TAGGER_MODEL}"`));
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
  const src = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");
  assert.ok(src.includes(`"${ROUTER_MODEL}"`));
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MAIN_MODEL, GRADER_MODELS, TOKENS_RESIDENT, TOKENS_GRADER, GRADER_OPTS, MAX_TURNS, getProfiles, createSession } from "../public/config.js";

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
    agreementNoticeShown: false,
  });
  a.turnHistory.push({ sender: "x", text: "y" });
  assert.deepEqual(createSession().turnHistory, []);
});

test("getProfiles covers every topic and difficulty, and falls back for unknown ones", () => {
  for (const topic of ["noise", "cleaning", "guest policy", "hygiene", "shared items"]) {
    for (const d of ["easy", "medium", "hard"]) {
      const p = getProfiles(topic, d);
      assert.ok(p.alex.stance && p.jordan.stance && p.alex.mood && p.jordan.mood);
    }
  }
  assert.deepEqual(getProfiles("nope", "nope"), getProfiles("noise", "medium"));
});

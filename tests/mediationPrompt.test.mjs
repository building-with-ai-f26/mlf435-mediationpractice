import { test } from "node:test";
import assert from "node:assert/strict";
import { mediationPrompt } from "../public/logic.js";

const profile = {
  alex: { name: "Alex", meta: "20 · Junior · Biology", trait: "Early riser.", mood: "frustrated", stance: "Jordan's noise prevents sleep." },
  jordan: { name: "Jordan", meta: "19 · Sophomore · Communications", trait: "Night owl.", mood: "defensive", stance: "Evening classes mean late nights." },
};

test("contains speaker mood and stance", () => {
  const prompt = mediationPrompt("noise", "medium", [], "Alex", 1, profile);
  assert.ok(prompt.includes("frustrated"));
  assert.ok(prompt.includes("Jordan's noise prevents sleep."));
  assert.ok(prompt.includes("Alex."));
});

test("does not contain other resident's stance", () => {
  const prompt = mediationPrompt("noise", "medium", [], "Alex", 1, profile);
  assert.ok(!prompt.includes("Evening classes mean late nights."));
});

test("turn-count pressure text is gone at every turn", () => {
  for (const turn of [1, 4, 6, 9]) {
    const prompt = mediationPrompt("noise", "medium", [], "Alex", turn, profile);
    assert.ok(!/CRITICAL|IMPORTANT|MUST show willingness|openness to compromise/.test(prompt));
  }
});

test("each openness level adds its own band text", () => {
  const expected = [
    /OPENNESS 0 of 3.*guarded.*short.*defend.*do not brainstorm/,
    /OPENNESS 1 of 3.*softer.*starting to trust the RA.*look at a fair plan.*do not give up a must-have/,
    /OPENNESS 2 of 3.*explaining how this really affects you.*willing to consider options/,
    /OPENNESS 3 of 3.*compromise.*one small concrete step.*only agree to a plan after the RA asks what you would be willing to try/,
  ];
  expected.forEach((re, level) => {
    const prompt = mediationPrompt("noise", "medium", [], "Alex", 1, profile, level);
    assert.match(prompt, re);
    assert.equal((prompt.match(/OPENNESS \d of 3/g) || []).length, 1);
  });
});

test("openness defaults to the difficulty's starting level", () => {
  assert.match(mediationPrompt("noise", "easy", [], "Alex", 1, profile), /OPENNESS 1 of 3/);
  assert.match(mediationPrompt("noise", "medium", [], "Alex", 1, profile), /OPENNESS 0 of 3/);
  assert.match(mediationPrompt("noise", "hard", [], "Jordan", 1, profile), /OPENNESS 0 of 3/);
});

test("contains transcript when history present", () => {
  const history = [{ sender: "RA", text: "How are you?" }];
  const prompt = mediationPrompt("noise", "medium", history, "Jordan", 1, profile);
  assert.ok(prompt.includes("RA: How are you?"));
});

test("length rule is 1 to 3 short spoken sentences, no lists", () => {
  const prompt = mediationPrompt("noise", "medium", [], "Alex", 1, profile);
  assert.ok(prompt.includes("1 to 3 short sentences"));
  assert.ok(prompt.includes("college student"));
  assert.ok(prompt.includes("No lists"));
  assert.ok(!prompt.includes("MAXIMUM"));
  assert.ok(!prompt.includes("2 paragraphs"));
});

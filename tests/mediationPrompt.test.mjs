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

test("turn 4 pressure text included", () => {
  const prompt = mediationPrompt("noise", "medium", [], "Alex", 4, profile);
  assert.ok(prompt.includes("openness to compromise"));
  assert.ok(!prompt.includes("CRITICAL"));
});

test("turn 6+ critical pressure text included", () => {
  const prompt = mediationPrompt("noise", "hard", [], "Jordan", 6, profile);
  assert.ok(prompt.includes("MUST show willingness"));
});

test("turn 3 has no pressure text", () => {
  const prompt = mediationPrompt("noise", "medium", [], "Alex", 3, profile);
  assert.ok(!prompt.includes("compromise"));
});

test("contains transcript when history present", () => {
  const history = [{ sender: "RA", text: "How are you?" }];
  const prompt = mediationPrompt("noise", "medium", history, "Jordan", 1, profile);
  assert.ok(prompt.includes("RA: How are you?"));
});

test("contains MAXIMUM 2 paragraphs rule", () => {
  const prompt = mediationPrompt("noise", "medium", [], "Alex", 1, profile);
  assert.ok(prompt.includes("MAXIMUM 2 paragraphs"));
});

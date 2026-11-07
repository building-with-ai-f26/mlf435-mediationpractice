import test from "node:test";
import assert from "node:assert/strict";
import { mockResponse, classifyPrompt } from "../public/mock.js";
import { parseGrading, extractContent, mediationPrompt, isConfirmation, bothAgreed } from "../public/logic.js";

const profile = d => {
  const mood = { easy: ["annoyed but open", "defensive but reasonable"], medium: ["frustrated, exhausted", "defensive, feels attacked"], hard: ["at breaking point", "angry, shutting down"] }[d];
  const mk = (name, m) => ({ name, meta: "m", trait: "t.", mood: m, stance: "s" });
  return { alex: mk("Alex", mood[0]), jordan: mk("Jordan", mood[1]) };
};
const reply = (prompt) => extractContent(mockResponse("x", [{ role: "system", content: prompt }]));

for (const d of ["easy", "medium", "hard"]) {
  test(`mock grader parses with 2 strengths and 2 gaps (${d})`, () => {
    const g = parseGrading(reply(`Grade this RA mediation practice session.\nDifficulty: ${d}`), "m");
    assert.equal(typeof g.score, "number");
    assert.equal(g.strengths.length, 2);
    assert.equal(g.gaps.length, 2);
  });

  test(`mock residents reply in <=2 paragraphs, and agree by turn 6 (${d})`, () => {
    const p = profile(d);
    for (const who of ["Alex", "Jordan"]) {
      for (const turn of [1, 4, 6]) {
        const prompt = mediationPrompt("noise", d, [{ sender: "RA", text: "hi" }], who, turn, p);
        assert.equal(classifyPrompt(prompt), "mediation");
        const text = reply(prompt);
        assert.ok(text.split(/\n{2,}/).length <= 2);
        assert.ok(!/[\u2014\u2013]/.test(text));
        if (turn === 6) assert.ok(isConfirmation(text), `${who} late reply should confirm: ${text}`);
      }
    }
    const h = ["Alex", "Jordan"].map(w => ({ sender: w, text: reply(mediationPrompt("noise", d, [], w, 6, p)) }));
    assert.ok(bothAgreed(h));
  });
}

test("mock consolidator has all three headings", () => {
  const t = reply("1 AI supervisor(s) graded. Consolidate the feedback into one debrief.");
  assert.match(t, /WHAT YOU DID WELL:/);
  assert.match(t, /WHAT YOU MISSED:/);
  assert.match(t, /ONE THING TO TRY NEXT TIME:/);
});

test("mock includes usage", () => {
  assert.ok(mockResponse("x", [{ content: "hello" }]).usage.total_tokens > 0);
});

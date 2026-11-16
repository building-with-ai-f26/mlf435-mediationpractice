import test from "node:test";
import assert from "node:assert/strict";
import { mockResponse, classifyPrompt } from "../public/mock.js";
import { getProfiles, alexPrompt, jordanPrompt } from "../public/config.js";
import { extractContent, mediationPrompt, isConfirmation, bothAgreed } from "../public/logic.js";
import { buildRubricPrompt, parseRubricReply, verifyEvidence, combineGraders, scoreFromCombined } from "../public/rubric.js";

const profile = d => getProfiles("noise", d);
const reply = (prompt) => extractContent(mockResponse("x", [{ role: "system", content: prompt }]));

const MODELS = ["deepseek/deepseek-chat", "anthropic/claude-haiku-5.5", "google/gemini-2.5-flash"];
const history = [
  { sender: "Alex", text: "Hi, I'm Alex. Jordan's noise keeps me up." },
  { sender: "Jordan", text: "I'm Jordan. My evening classes run late." },
  { sender: "Sam", text: "Thanks for coming, both of you will get a turn to speak. Alex, what is going on for you?" },
  { sender: "Alex", text: "I cannot sleep." },
  { sender: "Sam", text: "It sounds like you are exhausted. Jordan, what would you be willing to try?" },
];
const rubricReply = (model, h = history) => reply2(model, buildRubricPrompt("noise", "medium", h, "Sam"));
const reply2 = (model, prompt) => extractContent(mockResponse(model, [{ role: "system", content: prompt }]));

test("classifyPrompt recognises the real rubric prompt", () => {
  assert.equal(classifyPrompt(buildRubricPrompt("noise", "easy", history, "Sam")), "rubric");
});

for (const model of MODELS) {
  test(`mock rubric reply parses, has a mix of YES and NO, and every quote verifies (${model})`, () => {
    const parsed = parseRubricReply(rubricReply(model));
    assert.equal(parsed.ok, true);
    const yes = Object.values(parsed.answers).filter(a => a.yes).length;
    assert.ok(yes > 0 && yes < 15, `yes count ${yes}`);
    const v = verifyEvidence(parsed.answers, history);
    assert.deepEqual(v.changed, []);
    assert.doesNotMatch(rubricReply(model), /[\u2014\u2013]/);
  });
}

test("mock quotes come from RA lines only, at most 12 words", () => {
  const parsed = parseRubricReply(rubricReply(MODELS[0]));
  for (const a of Object.values(parsed.answers).filter(x => x.yes)) {
    assert.ok(a.quote.split(/\s+/).length <= 12);
    assert.ok(history.some(h => h.sender === "Sam" && h.text.includes(a.quote)), a.quote);
  }
});

test("mock graders disagree, so the debrief shows mixed agreement", () => {
  const graded = MODELS.map(m => parseRubricReply(rubricReply(m)));
  const combined = combineGraders(graded);
  assert.ok(combined.some(c => c.votes === 3));
  assert.ok(combined.some(c => c.votes > 0 && c.votes < 3));
  const { met, score } = scoreFromCombined(combined);
  assert.ok(met > 0 && met < 15);
  assert.equal(score, Math.round(met / 15 * 100));
});

test("mock with no RA lines answers NO to everything", () => {
  const onlyResidents = history.filter(h => h.sender !== "Sam");
  const parsed = parseRubricReply(rubricReply(MODELS[0], onlyResidents));
  assert.equal(parsed.ok, true);
  assert.equal(Object.values(parsed.answers).some(a => a.yes), false);
});

for (const d of ["easy", "medium", "hard"]) {
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

test("mock includes usage", () => {
  assert.ok(mockResponse("x", [{ content: "hello" }]).usage.total_tokens > 0);
});

// Drift guard: build the REAL prompts and check the mock still recognises each one.
// If someone edits a prompt in config.js, logic.js or rubric.js and the mock stops matching, this fails.
test("mock recognises the real intro prompts and picks the right difficulty", () => {
  const alexIntros = {};
  for (const d of ["easy", "medium", "hard"]) {
    const p = getProfiles("noise", d);
    const aPrompt = alexPrompt("noise", d, p);
    const jPrompt = jordanPrompt("noise", d, p, "Hi, I'm Alex.");
    assert.equal(classifyPrompt(aPrompt), "alex-intro", `alex ${d}`);
    assert.equal(classifyPrompt(jPrompt), "jordan-intro", `jordan ${d}`);
    alexIntros[d] = reply(aPrompt);
    assert.notEqual(alexIntros[d], reply(jPrompt));
    assert.ok(alexIntros[d].split(/\n{2,}/).length === 2);
  }
  assert.equal(new Set(Object.values(alexIntros)).size, 3, "each difficulty has its own intro");
  assert.match(alexIntros.hard, /end of my rope/);
  assert.match(alexIntros.easy, /late-night noise/);
});

test("mock recognises the real mediation and rubric prompts", () => {
  const p = getProfiles("noise", "medium");
  for (const who of ["Alex", "Jordan"]) {
    for (const turn of [1, 3, 6]) {
      assert.equal(classifyPrompt(mediationPrompt("noise", "medium", [{ sender: "Sam", text: "hi" }], who, turn, p)), "mediation", `${who} turn ${turn}`);
    }
  }
  assert.equal(classifyPrompt(buildRubricPrompt("noise", "medium", [{ sender: "Sam", text: "hi" }], "Sam")), "rubric");
  assert.equal(classifyPrompt("something else entirely"), "unknown");
});

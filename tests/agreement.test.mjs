import test from "node:test";
import assert from "node:assert/strict";
import { isConfirmation, bothAgreed } from "../public/logic.js";

const yes = ["That works for me. I'll keep it down after 10.", "Deal, let's start tonight.",
  "Yes, I'll keep the music off by 11 on weeknights.", "I'm willing to try quiet hours starting tomorrow."];
const no = [
  ["Can we try quiet hours?", "question"],
  ["That sounds fair, but I doubt it will last.", "hedge"],
  ["I agree with the idea, I just don't think it works.", "hedge"],
  ["Sounds good.", "vague, no concrete plan"],
  ["Deal.", "no concrete plan"],
  ["That works for me, but only if Alex stops complaining.", "but"],
  ["I won't do that after 10.", "refusal"],
  ["Deal, can we start tonight?", "question"],
  ["", "empty"],
];
for (const t of yes) test(`confirms: ${t}`, () => assert.equal(isConfirmation(t), true));
for (const [t, why] of no) test(`rejects (${why}): ${t}`, () => assert.equal(isConfirmation(t), false));

const A = "That works for me. I'll keep it down after 10.";
const J = "Deal, let's start tonight.";
const push = "I don't think this is fair to me.";
const h = (s, t) => ({ sender: s, text: t });

test("both confirm", () => assert.equal(bothAgreed([h("Alex", A), h("Jordan", J)]), true));
test("agreement cancelled by later pushback", () =>
  assert.equal(bothAgreed([h("Alex", A), h("Jordan", J), h("Sam", "ok"), h("Alex", push)]), false));
test("can re-agree after backing out", () =>
  assert.equal(bothAgreed([h("Alex", A), h("Jordan", J), h("Alex", push), h("Alex", A)]), true));
test("only one confirms", () =>
  assert.equal(bothAgreed([h("Alex", A), h("Jordan", push), h("Alex", A)]), false));
test("RA messages are ignored", () =>
  assert.equal(bothAgreed([h("Alex", A), h("Sam", "Sounds good?"), h("Jordan", J)]), true));
test("empty history", () => assert.equal(bothAgreed([]), false));

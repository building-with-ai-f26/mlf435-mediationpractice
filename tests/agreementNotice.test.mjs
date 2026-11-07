import test from "node:test";
import assert from "node:assert/strict";
import { shouldShowAgreementNotice } from "../public/logic.js";

const A = "That works for me. I'll keep it down after 10.";
const J = "Deal, let's start tonight.";
const h = (s, t) => ({ sender: s, text: t });

test("notice shows once, then not again while agreement continues", () => {
  const s = { turnHistory: [h("Alex", A), h("Jordan", J)], agreementNoticeShown: false };
  assert.equal(shouldShowAgreementNotice(s), true);
  assert.equal(shouldShowAgreementNotice(s), false);
  s.turnHistory.push(h("Sam", "Great"), h("Alex", A));
  assert.equal(shouldShowAgreementNotice(s), false);
});

test("no notice without agreement, and flag stays unset", () => {
  const s = { turnHistory: [h("Alex", A)], agreementNoticeShown: false };
  assert.equal(shouldShowAgreementNotice(s), false);
  assert.equal(s.agreementNoticeShown, false);
});

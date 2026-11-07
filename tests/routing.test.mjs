import { test } from "node:test";
import assert from "node:assert/strict";
import { getResponder } from "../public/logic.js";

test("name at start", () => {
  assert.equal(getResponder("Alex, what would help?", "Alex"), "Alex");
  assert.equal(getResponder("Jordan, what time do you get back?", "Jordan"), "Jordan");
});

test("name in middle", () => {
  assert.equal(getResponder("I want to ask Alex about mornings.", "Alex"), "Alex");
  assert.equal(getResponder("Let me turn to Jordan for a second.", "Jordan"), "Jordan");
});

test("name at end", () => {
  assert.equal(getResponder("What do you think, Alex?", "Alex"), "Alex");
  assert.equal(getResponder("Does that work for you, Jordan", "Jordan"), "Jordan");
});

test("lowercase and possessive", () => {
  assert.equal(getResponder("alex how are you", "Jordan"), "Alex");
  assert.equal(getResponder("JORDAN, go ahead", "Alex"), "Jordan");
  assert.equal(getResponder("Alex's side makes sense", "Jordan"), "Alex");
});

test("both names: alternate from last speaker", () => {
  assert.equal(getResponder("Alex and Jordan, thoughts?", "Alex"), "Jordan");
  assert.equal(getResponder("Alex and Jordan, thoughts?", "Jordan"), "Alex");
});

test("no names: alternate from last speaker", () => {
  assert.equal(getResponder("I hear both of you.", "Alex"), "Jordan");
  assert.equal(getResponder("I hear both of you.", "Jordan"), "Alex");
  assert.equal(getResponder("", "Alex"), "Jordan");
});

test("Jordanian and Alexandra do not match", () => {
  assert.equal(getResponder("The Jordanian student is nice.", "Jordan"), "Alex");
  assert.equal(getResponder("Alexandra, hi", "Alex"), "Jordan");
});

test("regression: the old string pattern never matched", () => {
  assert.equal(new RegExp("\balex\b", "i").test("Alex, hi"), false);
  assert.equal(/\balex\b/i.test("Alex, hi"), true);
});

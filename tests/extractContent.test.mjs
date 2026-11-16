import { test } from "node:test";
import assert from "node:assert/strict";
import { extractContent } from "../public/logic.js";

test("normal response returns trimmed content", () => {
  assert.equal(extractContent({ choices: [{ message: { content: "  hello  " } }] }), "hello");
});

test("empty content throws", () => {
  assert.throws(() => extractContent({ choices: [{ message: { content: "" } }] }), /Empty model response/);
});

test("content with only whitespace throws", () => {
  assert.throws(() => extractContent({ choices: [{ message: { content: "   " } }] }), /Empty model response/);
});

test("null content throws", () => {
  assert.throws(() => extractContent({ choices: [{ message: { content: null } }] }), /Empty model response/);
});

test("reasoning only throws", () => {
  assert.throws(() => extractContent({ choices: [{ message: { content: "", reasoning: "thinking..." } }] }), /Empty model response/);
});

test("missing choices throws", () => {
  assert.throws(() => extractContent({ choices: [] }), /Empty model response/);
});

test("missing message throws", () => {
  assert.throws(() => extractContent({ choices: [{}] }), /Empty model response/);
});

test("empty object throws", () => {
  assert.throws(() => extractContent({}), /Empty model response/);
});

import { cleanResponse } from "../public/logic.js";

test("cleanResponse strips a bold name prefix, swaps dashes and curly quotes, and keeps 2 paragraphs", () => {
  assert.equal(cleanResponse("**Alex** I\u2019m tired \u2014 really."), "I'm tired  -  really.");
  assert.equal(cleanResponse("one\n\ntwo\n\nthree\n\nfour"), "one\n\ntwo three four");
  assert.equal(cleanResponse("plain text"), "plain text");
});

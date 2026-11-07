import test from "node:test";
import assert from "node:assert/strict";
import { isTurnCapReached, formatUsage } from "../public/logic.js";

test("isTurnCapReached", () => {
  assert.equal(isTurnCapReached(9, 10), false);
  assert.equal(isTurnCapReached(10, 10), true);
  assert.equal(isTurnCapReached(11, 10), true);
});

test("formatUsage logs token counts", () => {
  assert.equal(formatUsage("m", { prompt_tokens: 5, completion_tokens: 7, total_tokens: 12 }), "[tokens] m: prompt=5 completion=7 total=12");
  assert.match(formatUsage("m", undefined), /usage not reported/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { computeOverallScore, parseGrading } from "../public/logic.js";

const g = (...s) => s.map(score => ({ score }));
test("average", () => assert.equal(computeOverallScore(g(80, 70, 90)), 80));
test("rounds .5 up", () => assert.equal(computeOverallScore(g(80, 71)), 76));
test("null skipped, not zero", () => assert.equal(computeOverallScore(g(80, null, 60)), 70));
test("all null", () => assert.equal(computeOverallScore(g(null, null, null)), null));
test("empty", () => assert.equal(computeOverallScore([]), null));
test("clamped", () => assert.equal(computeOverallScore(g(150, -5)), 50));
test("real zero counts", () => assert.equal(computeOverallScore(g(0, 60)), 30));

test("parseGrading reads score and bullets", () => {
  const r = parseGrading("SCORE: 72/100\nSTRENGTHS:\n- a\n- b\nGAPS:\n- c\n- d", "X");
  assert.equal(r.score, 72);
  assert.deepEqual(r.strengths, ["a", "b"]);
  assert.deepEqual(r.gaps, ["c", "d"]);
});
test("parseGrading gives null score when missing", () =>
  assert.equal(parseGrading("no score here", "X").score, null));

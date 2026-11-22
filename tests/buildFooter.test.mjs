import test from "node:test";
import assert from "node:assert/strict";
import { formatBuildLabel } from "../public/logic.js";

test("shows the first 7 characters of the commit", () => {
  assert.equal(formatBuildLabel({ ok: true, commit: "200d0d6abc123456" }), "Build 200d0d6");
  assert.equal(formatBuildLabel({ ok: true, commit: "200d0d6" }), "Build 200d0d6");
});

test("empty label when the commit is unknown or malformed", () => {
  assert.equal(formatBuildLabel({ ok: true, commit: "unknown" }), "");
  assert.equal(formatBuildLabel({ ok: true }), "");
  assert.equal(formatBuildLabel(null), "");
  assert.equal(formatBuildLabel({ commit: "<script>" }), "");
});

import test from "node:test";
import assert from "node:assert/strict";
import { getAppMode } from "../public/logic.js";

test("github.io hosts are demo, even with ?mock=1", () => {
  assert.equal(getAppMode("someone.github.io", ""), "demo");
  assert.equal(getAppMode("Someone.GitHub.io", "?mock=1"), "demo");
});

test("?mock=1 on a local host is mock", () => {
  assert.equal(getAppMode("localhost", "?mock=1"), "mock");
});

test("local server without mock is live", () => {
  assert.equal(getAppMode("localhost", ""), "live");
  assert.equal(getAppMode("127.0.0.1", "?mock=0"), "live");
  assert.equal(getAppMode(undefined, undefined), "live");
});

test("lookalike hosts are not demo", () => {
  assert.equal(getAppMode("evilgithub.io", ""), "live");
  assert.equal(getAppMode("github.io.example.com", ""), "live");
});

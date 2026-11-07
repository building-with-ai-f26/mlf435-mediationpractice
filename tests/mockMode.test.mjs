import test from "node:test";
import assert from "node:assert/strict";
import { isMockMode } from "../public/logic.js";

test("github.io hosts force mock mode", () => {
  assert.equal(isMockMode("someone.github.io", ""), true);
  assert.equal(isMockMode("Someone.GitHub.io", "?x=1"), true);
  assert.equal(isMockMode("github.io", ""), true);
});

test("localhost is live unless ?mock=1", () => {
  assert.equal(isMockMode("localhost", ""), false);
  assert.equal(isMockMode("127.0.0.1", "?mock=0"), false);
  assert.equal(isMockMode("localhost", "?mock=1"), true);
});

test("lookalike hosts are not treated as github.io", () => {
  assert.equal(isMockMode("evilgithub.io", ""), false);
  assert.equal(isMockMode("github.io.example.com", ""), false);
  assert.equal(isMockMode(undefined, undefined), false);
});

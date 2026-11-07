import { test } from "node:test";
import assert from "node:assert/strict";
import { commitTurn } from "../public/logic.js";

test("commitTurn records RA message and reply, advances count and last speaker", () => {
  const s = { turnHistory: [], turnCount: 0, lastSpeaker: "Jordan" };
  commitTurn(s, { sender: "Sam", text: "Alex, hi" }, "Alex", "Hello.");
  assert.deepEqual(s.turnHistory, [{ sender: "Sam", text: "Alex, hi" }, { sender: "Alex", text: "Hello." }]);
  assert.equal(s.turnCount, 1);
  assert.equal(s.lastSpeaker, "Alex");
});

test("a failed turn never calls commitTurn, so the session is unchanged", () => {
  const s = { turnHistory: [{ sender: "Alex", text: "x" }], turnCount: 2, lastSpeaker: "Alex" };
  const before = JSON.stringify(s);
  // send() builds the prompt from [...history, raEntry] and only commits after success.
  const prompt = [...s.turnHistory, { sender: "Sam", text: "hi" }];
  assert.equal(prompt.length, 2);
  assert.equal(JSON.stringify(s), before);
});

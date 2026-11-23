import { test } from "node:test";
import assert from "node:assert/strict";
import { validateChatBody, cleanReasoning, MAX_TOKENS_CAP } from "../chatBody.mjs";

const allowed = new Set(["deepseek/deepseek-chat"]);
const base = { model: "deepseek/deepseek-chat", messages: [{ role: "system", content: "x" }] };

test("cap is 2000, so a 1500 token grader request is not clamped", () => {
  assert.equal(MAX_TOKENS_CAP, 2000);
  assert.equal(validateChatBody({ ...base, max_tokens: 1500 }, allowed).clean.max_tokens, 1500);
  assert.equal(validateChatBody({ ...base, max_tokens: 99999 }, allowed).clean.max_tokens, 2000);
});

test("valid reasoning shapes are passed through", () => {
  for (const r of [{ enabled: false }, { enabled: true }, { effort: "low" }, { max_tokens: 1024 }]) {
    assert.deepEqual(validateChatBody({ ...base, reasoning: r }, allowed).clean.reasoning, r);
  }
});

test("no reasoning field in, none out", () => {
  assert.equal("reasoning" in validateChatBody(base, allowed).clean, false);
});

test("bad reasoning shapes are rejected with an error", () => {
  const bad = ["low", 5, null, [], {}, { enabled: "no" }, { effort: "extreme" }, { max_tokens: 0 }, { max_tokens: 2001 },
    { max_tokens: 1.5 }, { enabled: false, effort: "low" }, { exclude: true }, { enabled: false, extra: 1 }];
  for (const r of bad) {
    assert.equal(cleanReasoning(r), null, JSON.stringify(r));
    assert.equal(validateChatBody({ ...base, reasoning: r }, allowed).error, "Invalid reasoning setting", JSON.stringify(r));
  }
});

test("unknown top-level fields are dropped, not forwarded", () => {
  const { clean } = validateChatBody({ ...base, stream: true, provider: { order: ["x"] }, tools: [] }, allowed);
  assert.deepEqual(Object.keys(clean).sort(), ["max_tokens", "messages", "model"]);
});

test("existing checks still reject bad model, messages, and body", () => {
  assert.equal(validateChatBody({ ...base, model: "evil/model" }, allowed).error, "Model not allowed");
  assert.equal(validateChatBody({ ...base, messages: [] }, allowed).error, "messages must be a non-empty array");
  assert.equal(validateChatBody([], allowed).error, "Invalid request");
});

import { buildOpenRouterBody, zdrEnabled } from "../chatBody.mjs";

test("zdr: body always has provider zdr true when flag is on (default)", () => {
  const allowed = new Set(["m"]);
  const { clean } = validateChatBody({ model: "m", messages: [{ role: "user", content: "x" }] }, allowed);
  for (const env of [{}, { OPENROUTER_ZDR: "true" }, { OPENROUTER_ZDR: "1" }]) {
    assert.deepEqual(buildOpenRouterBody(clean, env).provider, { zdr: true, data_collection: "deny" });
  }
});

test("zdr: browser cannot set provider; flag off removes it", () => {
  const allowed = new Set(["m"]);
  const { clean } = validateChatBody({ model: "m", messages: [{ role: "user", content: "x" }], provider: { zdr: false } }, allowed);
  assert.equal(clean.provider, undefined);
  assert.equal(buildOpenRouterBody(clean, {}).provider.zdr, true);
  assert.equal(zdrEnabled({ OPENROUTER_ZDR: "false" }), false);
  assert.equal(buildOpenRouterBody(clean, { OPENROUTER_ZDR: "false" }).provider, undefined);
});

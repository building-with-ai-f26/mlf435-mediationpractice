import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRequestBody } from "../public/logic.js";

const msgs = [{ role: "user", content: "hi" }];

test("defaults match resident replies: temperature 0.8, 150 tokens, no reasoning field", () => {
  const body = buildRequestBody("deepseek/deepseek-chat", msgs);
  assert.deepEqual(body, { model: "deepseek/deepseek-chat", messages: msgs, temperature: 0.8, max_tokens: 150 });
  assert.equal("reasoning" in body, false);
});

test("grader options set temperature 0, larger max_tokens, and reasoning", () => {
  const body = buildRequestBody("anthropic/claude-haiku-5.5", msgs, { maxTokens: 1500, temperature: 0, reasoning: { enabled: false } });
  assert.equal(body.temperature, 0);
  assert.equal(body.max_tokens, 1500);
  assert.deepEqual(body.reasoning, { enabled: false });
});

test("temperature 0 is kept, not replaced by the 0.8 default", () => {
  assert.equal(buildRequestBody("m", msgs, { temperature: 0 }).temperature, 0);
});

test("config.js and app.js: residents default to 150 tokens, graders use temperature 0 with reasoning off", async () => {
  const { readFileSync } = await import("node:fs");
  const read = f => readFileSync(new URL(`../public/${f}`, import.meta.url), "utf8");
  const config = read("config.js"), app = read("app.js");
  assert.match(config, /export const TOKENS_RESIDENT = 150;/);
  assert.match(config, /export const TOKENS_GRADER = 2000;/);
  assert.match(config, /export const GRADER_OPTS = \{ maxTokens: TOKENS_GRADER, temperature: 0, reasoning: \{ enabled: false \} \};/);
  assert.match(app, /async function call\(model, messages, opts = \{ maxTokens: TOKENS_RESIDENT \}, role = "resident"\)/);
});

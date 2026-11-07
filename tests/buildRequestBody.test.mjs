import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRequestBody } from "../public/logic.js";

test("includes model, messages, temperature, and max_tokens", () => {
  const body = buildRequestBody("deepseek/deepseek-chat", [{ role: "user", content: "hi" }], 600);
  assert.equal(body.model, "deepseek/deepseek-chat");
  assert.deepEqual(body.messages, [{ role: "user", content: "hi" }]);
  assert.equal(body.temperature, 0.8);
  assert.equal(body.max_tokens, 600);
});

test("call() default is the resident limit of 150", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(src, /const TOKENS_RESIDENT = 150;/);
  assert.match(src, /async function call\(model, messages, maxTokens = TOKENS_RESIDENT\)/);
});

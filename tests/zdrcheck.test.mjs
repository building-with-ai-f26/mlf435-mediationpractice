import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArgs, isListed, checkModel } from "../tools/zdrcheck.mjs";

test("parseArgs: --max-cost defaults to 0.05, extra model ids are collected, bad input is refused", () => {
  assert.deepEqual(parseArgs([]), { maxCost: 0.05, extra: [] });
  assert.deepEqual(parseArgs(["--max-cost", "0.01", "a/b", "c/d"]), { maxCost: 0.01, extra: ["a/b", "c/d"] });
  assert.throws(() => parseArgs(["--max-cost", "abc"]), /--max-cost/);
  assert.throws(() => parseArgs(["--nope"]), /Unknown flag/);
});

test("isListed matches the exact model id", () => {
  const rows = [{ model_id: "a/b" }, { model_id: "c/d" }];
  assert.equal(isListed(rows, "a/b"), true);
  assert.equal(isListed(rows, "a/bb"), false);
  assert.equal(isListed([], "a/b"), false);
});

test("checkModel: ok, the zero retention error, and any other error", async () => {
  const sent = [];
  const ok = await checkModel("a/b", async clean => { sent.push(clean); return { ok: true, status: 200, data: { usage: { cost: 0.0001 } } }; });
  assert.deepEqual(ok, { request: "ok", usd: 0.0001 });
  // 20 token reply, reasoning off, nothing for the browser to set: the request is the app's own shape.
  assert.equal(sent[0].max_tokens, 20);
  assert.deepEqual(sent[0].reasoning, { enabled: false });
  const none = await checkModel("a/b", async () => ({ ok: false, status: 404, data: { error: { message: "No endpoints found matching your data policy (Zero data retention)." } } }));
  assert.match(none.request, /^NO ZERO RETENTION ROUTE/);
  const other = await checkModel("a/b", async () => ({ ok: false, status: 429, data: { error: { message: "Rate limited" } } }));
  assert.equal(other.request, "Rate limited");
  const thrown = await checkModel("a/b", async () => { throw new Error("network down"); });
  assert.equal(thrown.request, "network down");
});

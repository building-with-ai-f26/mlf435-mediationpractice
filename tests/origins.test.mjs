import test from "node:test";
import assert from "node:assert/strict";
import { isOriginAllowed } from "../origins.mjs";

test("accepts localhost origin", () => assert.equal(isOriginAllowed("http://localhost:3000", 3000), true));
test("accepts 127.0.0.1 origin", () => assert.equal(isOriginAllowed("http://127.0.0.1:3000", 3000), true));
test("rejects other port", () => assert.equal(isOriginAllowed("http://localhost:3001", 3000), false));
test("rejects other host", () => assert.equal(isOriginAllowed("http://evil.example", 3000), false));
test("rejects https and undefined", () => {
  assert.equal(isOriginAllowed("https://localhost:3000", 3000), false);
  assert.equal(isOriginAllowed(undefined, 3000), false);
});

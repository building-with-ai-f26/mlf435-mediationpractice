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

import { parsePublicOrigins, isHostAllowed } from "../origins.mjs";

test("parsePublicOrigins splits, trims, drops bad entries and paths", () => {
  assert.deepEqual(parsePublicOrigins(" https://a.example.edu/ , http://b.example:8080/x, nonsense, ftp://c.example,"),
    ["https://a.example.edu", "http://b.example:8080"]);
  assert.deepEqual(parsePublicOrigins(undefined), []);
});
test("PUBLIC_ORIGIN origin is accepted, a random one is rejected", () => {
  const pub = parsePublicOrigins("https://ra.example.edu");
  assert.equal(isOriginAllowed("https://ra.example.edu", 3000, pub), true);
  assert.equal(isOriginAllowed("https://evil.example", 3000, pub), false);
  assert.equal(isOriginAllowed("http://ra.example.edu", 3000, pub), false);
  assert.equal(isOriginAllowed("https://ra.example.edu", 3000), false);
});
test("host check follows PUBLIC_ORIGIN", () => {
  const pub = parsePublicOrigins("https://ra.example.edu,http://x.example:8080");
  assert.equal(isHostAllowed("ra.example.edu", 3000, pub), true);
  assert.equal(isHostAllowed("x.example:8080", 3000, pub), true);
  assert.equal(isHostAllowed("localhost:3000", 3000, pub), true);
  assert.equal(isHostAllowed("evil.example", 3000, pub), false);
  assert.equal(isHostAllowed("ra.example.edu", 3000), false);
});

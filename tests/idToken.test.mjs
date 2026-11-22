import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeIdToken, isTokenValid, getEnvName } from "../public/logic.js";

const b64 = o => Buffer.from(JSON.stringify(o)).toString("base64url");
const tok = p => `${b64({ alg: "RS256" })}.${b64(p)}.sig`;

test("decodeIdToken reads given_name and sub, including non-ASCII", () => {
  const p = decodeIdToken(tok({ sub: "123", given_name: "José" }));
  assert.equal(p.given_name, "José");
  assert.equal(p.sub, "123");
});
test("decodeIdToken returns null for junk", () => {
  assert.equal(decodeIdToken("nope"), null);
  assert.equal(decodeIdToken(""), null);
  assert.equal(decodeIdToken(undefined), null);
});
test("isTokenValid checks expiry", () => {
  const now = 1_000_000_000_000;
  assert.equal(isTokenValid(tok({ exp: now / 1000 + 3600 }), now), true);
  assert.equal(isTokenValid(tok({ exp: now / 1000 - 1 }), now), false);
  assert.equal(isTokenValid(tok({}), now), false);
});
test("getEnvName", () => {
  assert.equal(getEnvName("localhost"), "local");
  assert.equal(getEnvName("127.0.0.1"), "local");
  assert.equal(getEnvName("ra.example.edu"), "production");
});

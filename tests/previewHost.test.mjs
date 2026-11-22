import test from "node:test";
import assert from "node:assert/strict";
import { previewOrigins, isOriginAllowed, isHostAllowed, parsePublicOrigins } from "../origins.mjs";

const HOST = "ra-practice-pr-4.onrender.com";
const accepted = env => [...parsePublicOrigins("https://ra.example.edu"), ...previewOrigins(env)];

test("preview host is allowed only when IS_PULL_REQUEST is exactly true", () => {
  const on = accepted({ IS_PULL_REQUEST: "true", RENDER_EXTERNAL_HOSTNAME: HOST });
  assert.equal(isHostAllowed(HOST, 3000, on), true);
  assert.equal(isOriginAllowed(`https://${HOST}`, 3000, on), true);
  for (const flag of [undefined, "", "false", "TRUE", "1", "yes", " true"]) {
    const off = accepted({ IS_PULL_REQUEST: flag, RENDER_EXTERNAL_HOSTNAME: HOST });
    assert.equal(isHostAllowed(HOST, 3000, off), false, `flag ${flag}`);
    assert.equal(isOriginAllowed(`https://${HOST}`, 3000, off), false, `flag ${flag}`);
  }
});

test("on a preview, other hosts and origins are still refused", () => {
  const on = accepted({ IS_PULL_REQUEST: "true", RENDER_EXTERNAL_HOSTNAME: HOST });
  assert.equal(isHostAllowed("evil.example", 3000, on), false);
  assert.equal(isHostAllowed("ra-practice-pr-5.onrender.com", 3000, on), false);
  assert.equal(isHostAllowed(`x.${HOST}`, 3000, on), false);
  assert.equal(isOriginAllowed("https://evil.example", 3000, on), false);
  assert.equal(isOriginAllowed(`http://${HOST}`, 3000, on), false);
  assert.equal(isHostAllowed(undefined, 3000, on), false);
});

test("hostname must be one plain DNS name: no wildcard, port, scheme, path or list", () => {
  for (const bad of ["*.onrender.com", "a.onrender.com:443", "https://a.onrender.com", "a.onrender.com/x", "a.onrender.com,b.onrender.com", "localhost", "", undefined]) {
    assert.deepEqual(previewOrigins({ IS_PULL_REQUEST: "true", RENDER_EXTERNAL_HOSTNAME: bad }), [], `host ${bad}`);
  }
});

test("production is unchanged: no flag means no extra origins, PUBLIC_ORIGIN still works", () => {
  assert.deepEqual(previewOrigins({}), []);
  assert.deepEqual(previewOrigins({ RENDER_EXTERNAL_HOSTNAME: HOST }), []);
  const prod = accepted({ IS_PULL_REQUEST: "false", RENDER_EXTERNAL_HOSTNAME: "ra-practice.onrender.com" });
  assert.equal(isHostAllowed("ra.example.edu", 3000, prod), true);
  assert.equal(isHostAllowed("ra-practice.onrender.com", 3000, prod), false);
  assert.equal(isHostAllowed("localhost:3000", 3000, prod), true);
});

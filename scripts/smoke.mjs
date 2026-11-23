#!/usr/bin/env node
// Post-deploy smoke check. Usage: node scripts/smoke.mjs <base URL> [--commit <sha>]
// Makes plain HTTP requests only. No key, no AI calls.
import { RESIDENT_MODEL } from "../public/config.js";
const args = process.argv.slice(2);
const ci = args.indexOf("--commit");
const commit = ci >= 0 ? args[ci + 1] : null;
if (ci >= 0) args.splice(ci, 2);
const base = (args[0] || "").replace(/\/+$/, "");
if (!/^https?:\/\//.test(base) || (ci >= 0 && !commit)) {
  console.error("Usage: node scripts/smoke.mjs <base URL> [--commit <sha>]");
  process.exit(2);
}

let failed = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`);
  if (!ok) failed++;
};
const get = (p, opts) => fetch(base + p, { signal: AbortSignal.timeout(30000), ...opts });

try {
  const h = await get("/healthz");
  const body = await h.json().catch(() => ({}));
  check("/healthz is 200 and ok", h.status === 200 && body.ok === true, `status ${h.status}`);
  if (commit) {
    const got = String(body.commit || "");
    check("/healthz commit matches", got !== "" && (got.startsWith(commit) || commit.startsWith(got)), `got ${got || "none"}`);
  }

  const home = await get("/");
  const html = await home.text();
  check("/ serves the page", home.status === 200 && /<html/i.test(html), `status ${home.status}`);

  const chat = await get("/api/chat", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: RESIDENT_MODEL, messages: [{ role: "user", content: "smoke" }] }),
  });
  // The app has no login. Without a valid Origin and with live AI off it must not return 200.
  check("/api/chat without auth is rejected", chat.status >= 400, `status ${chat.status}`);

  const bad = await get("/api/chat", {
    method: "POST", headers: { "Content-Type": "application/json", Origin: "https://evil.example" }, body: "{}",
  });
  check("bad Origin is rejected with 403", bad.status === 403, `status ${bad.status}`);

  const want = {
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "strict-origin-when-cross-origin",
  };
  for (const [k, v] of Object.entries(want)) {
    check(`header ${k}`, h.headers.get(k) === v, `got ${h.headers.get(k)}`);
  }
} catch (err) {
  check("server reachable", false, err.message);
}
console.log(failed ? `${failed} check(s) failed` : "All checks passed");
process.exit(failed ? 1 : 0);

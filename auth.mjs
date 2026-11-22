// Google ID token check and setting reader. Only node:crypto and fetch. Imported by server.mjs and tests.
// The token is never logged and never put in an error message.
import crypto from "node:crypto";
import fs from "node:fs";

export const GOOGLE_CERTS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const KEY_CACHE_MS = 60 * 60 * 1000;
const ISSUERS = new Set(["accounts.google.com", "https://accounts.google.com"]);

// Reads a setting from the environment first, then from a KEY=value line in .env. Never logs it.
export function readSetting(name, env = process.env, envPath = ".env") {
  let v = (env[name] || "").trim();
  if (!v && fs.existsSync(envPath)) {
    const m = fs.readFileSync(envPath, "utf-8").match(new RegExp(`^${name}=(.+)$`, "m"));
    if (m) v = m[1].trim().replace(/^["']|["']$/g, "");
  }
  return v;
}

const b64urlJson = s => JSON.parse(Buffer.from(s, "base64url").toString("utf-8"));

// Returns verifyUser(token) -> { id, name } or null. fetchImpl and now are replaceable for tests.
export function createVerifier({ clientId, allowedDomain = "", fetchImpl = fetch, now = Date.now }) {
  let keys = null; // Map kid -> KeyObject
  let fetchedAt = 0;

  async function loadKeys() {
    if (keys && now() - fetchedAt < KEY_CACHE_MS) return keys;
    try {
      const res = await fetchImpl(GOOGLE_CERTS_URL, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) throw new Error("certs " + res.status);
      const body = await res.json();
      const map = new Map();
      for (const jwk of body.keys || []) {
        if (jwk.kid && jwk.kty === "RSA") map.set(jwk.kid, crypto.createPublicKey({ key: jwk, format: "jwk" }));
      }
      keys = map;
      fetchedAt = now();
    } catch {
      // Keep any older keys rather than locking everyone out when Google is briefly unreachable.
      if (!keys) return null;
    }
    return keys;
  }

  return async function verifyUser(token) {
    try {
      if (!clientId || typeof token !== "string") return null;
      const parts = token.split(".");
      if (parts.length !== 3) return null;
      const header = b64urlJson(parts[0]);
      if (header.alg !== "RS256" || typeof header.kid !== "string") return null;
      const map = await loadKeys();
      const key = map && map.get(header.kid);
      if (!key) return null;
      const ok = crypto.verify("RSA-SHA256", Buffer.from(parts[0] + "." + parts[1]), key, Buffer.from(parts[2], "base64url"));
      if (!ok) return null;
      const c = b64urlJson(parts[1]);
      if (!ISSUERS.has(c.iss)) return null;
      if (c.aud !== clientId) return null;
      if (typeof c.exp !== "number" || c.exp * 1000 <= now()) return null;
      if (typeof c.sub !== "string" || !c.sub) return null;
      if (allowedDomain) {
        if (!(c.email_verified === true || c.email_verified === "true")) return null;
        if (c.hd !== allowedDomain) return null;
      }
      return { id: c.sub, name: c.given_name };
    } catch {
      return null;
    }
  };
}

// In-memory limits for the API routes. Pure, so tests can use them without starting the server.
// State is lost on restart and is not shared between processes.

// Per-key sliding window. check() returns { ok: true } or { ok: false, retryAfter } (seconds).
export function createRateLimiter({ max, windowMs }) {
  const hits = new Map(); // key -> array of timestamps inside the window
  return {
    check(key, now = Date.now()) {
      const recent = (hits.get(key) || []).filter(t => now - t < windowMs);
      if (recent.length >= max) {
        hits.set(key, recent);
        return { ok: false, retryAfter: Math.max(1, Math.ceil((recent[0] + windowMs - now) / 1000)) };
      }
      recent.push(now);
      hits.set(key, recent);
      if (hits.size > 10000) { // drop idle clients so the map cannot grow forever
        for (const [k, v] of hits) if (!v.some(t => now - t < windowMs)) hits.delete(k);
      }
      return { ok: true };
    },
  };
}

// Global counter that resets at UTC midnight. reached() checks, count() adds one.
export function createDailyCap(cap) {
  let day = "";
  let used = 0;
  const roll = now => {
    const d = new Date(now).toISOString().slice(0, 10);
    if (d !== day) { day = d; used = 0; }
  };
  return {
    reached(now = Date.now()) { roll(now); return used >= cap; },
    count(now = Date.now()) { roll(now); used++; },
  };
}

// Reads a positive-or-zero number from an env value, else the default.
export function envNumber(value, fallback) {
  if (value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function envFlag(value) {
  return ["1", "true", "yes", "on"].includes(String(value ?? "").trim().toLowerCase());
}

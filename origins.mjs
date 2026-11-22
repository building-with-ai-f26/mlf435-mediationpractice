// Origins and hosts the server accepts. localhost and 127.0.0.1 are the same machine.
// publicOrigins: extra origins from the PUBLIC_ORIGIN env var (comma separated, e.g. "https://ra.example.edu").

// Parses PUBLIC_ORIGIN. Keeps only valid http(s) origins, drops paths and trailing slashes.
export function parsePublicOrigins(value) {
  const out = [];
  for (const part of String(value || "").split(",")) {
    const s = part.trim();
    if (!s) continue;
    try {
      const u = new URL(s);
      if (u.protocol === "http:" || u.protocol === "https:") out.push(u.origin);
    } catch { /* ignore a bad entry */ }
  }
  return out;
}

export function allowedOrigins(port, publicOrigins = []) {
  return [`http://localhost:${port}`, `http://127.0.0.1:${port}`, ...publicOrigins];
}

export function isOriginAllowed(origin, port, publicOrigins = []) {
  return allowedOrigins(port, publicOrigins).includes(origin);
}

export function allowedHosts(port, publicOrigins = []) {
  return [`localhost:${port}`, `127.0.0.1:${port}`, ...publicOrigins.map(o => new URL(o).host)];
}

export function isHostAllowed(host, port, publicOrigins = []) {
  return allowedHosts(port, publicOrigins).includes(host);
}

// Render pull request previews only. Returns [] unless IS_PULL_REQUEST is exactly "true".
// Then returns the one origin https://<RENDER_EXTERNAL_HOSTNAME> from the environment (never from a request).
// The hostname must be a plain DNS name: no wildcard, port, scheme or path.
export function previewOrigins(env = {}) {
  if (env.IS_PULL_REQUEST !== "true") return [];
  const h = String(env.RENDER_EXTERNAL_HOSTNAME || "").trim().toLowerCase();
  if (!/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(h)) return [];
  return [`https://${h}`];
}

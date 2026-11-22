import http from "http";
import fs from "fs";
import path from "path";
import { URL } from "url";
import { isOriginAllowed, isHostAllowed, parsePublicOrigins } from "./origins.mjs";
import { createRateLimiter, createDailyCap, envNumber, envFlag } from "./limits.mjs";
import { execSync } from "child_process";
import { validateChatBody } from "./chatBody.mjs";
import { MAX_TRANSCRIPT_BYTES, validateTranscript, saveTranscript } from "./liveTranscript.mjs";

const PORT = Number(process.env.PORT) || 3000;
const PRODUCTION = process.env.NODE_ENV === "production";
const PUBLIC_ORIGINS = parsePublicOrigins(process.env.PUBLIC_ORIGIN);
const ALLOWED_ORIGIN = PUBLIC_ORIGINS[0] || `http://localhost:${PORT}`;
// Render sets IS_PULL_REQUEST to the string "true" on pull request previews. A preview never calls the AI or writes files.
const IS_PREVIEW = envFlag(process.env.IS_PULL_REQUEST);
const LIVE_AI_ENABLED = !IS_PREVIEW && envFlag(process.env.LIVE_AI_ENABLED);
const rateLimiter = createRateLimiter({
  max: envNumber(process.env.RATE_LIMIT_MAX, 60),
  windowMs: envNumber(process.env.RATE_LIMIT_WINDOW_MINUTES, 10) * 60 * 1000,
});
const dailyCap = createDailyCap(envNumber(process.env.DAILY_CALL_CAP, 500));
const MAX_BODY_BYTES = 64 * 1024;
const LIVE_DIR = path.join(process.cwd(), "transcripts", "live");
// Render sets RENDER_GIT_COMMIT to the full SHA of the deploy. Locally we fall back to git.
let GIT_COMMIT = "unknown";
try { GIT_COMMIT = execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim() || "unknown"; } catch { /* not a git checkout */ }
const DEPLOY_COMMIT = (process.env.RENDER_GIT_COMMIT || "").trim() || GIT_COMMIT;

// Keep in sync with public/app.js (MAIN_MODEL, GRADER_MODELS, CONSOLIDATOR_MODEL). The two lists must match.
const ALLOWED_MODELS = new Set([
  "deepseek/deepseek-chat",
  "anthropic/claude-haiku-5.5",
  "google/gemini-2.5-flash",
]);

// The key comes from the environment first, then from .env. It is never logged.
const envPath = path.join(process.cwd(), ".env");
let OPENROUTER_API_KEY = (process.env.OPENROUTER_API_KEY || "").trim() || null;
if (!OPENROUTER_API_KEY && fs.existsSync(envPath)) {
  const envText = fs.readFileSync(envPath, "utf-8");
  const match = envText.match(/^OPENROUTER_API_KEY=(.+)$/m);
  if (match) OPENROUTER_API_KEY = match[1].trim();
}

if (!OPENROUTER_API_KEY) {
  console.error("ERROR: OPENROUTER_API_KEY not found in the environment or .env");
  process.exit(1);
}

const MIME_TYPES = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
};

const PUBLIC_DIR = path.resolve(process.cwd(), "public");

// Set on every response. No Content-Security-Policy yet: the PostHog snippet is inline.
const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
};

// Behind a proxy the real client is the first x-forwarded-for entry. Only trusted in production.
function clientIp(req) {
  if (PRODUCTION) {
    const first = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
    if (first) return first;
  }
  return req.socket.remoteAddress || "unknown";
}

// Checks shared by /api/chat and /api/transcript. Returns true if the request was refused.
function refusedByRateLimit(req, res) {
  const r = rateLimiter.check(clientIp(req));
  if (r.ok) return false;
  res.setHeader("Retry-After", String(r.retryAfter));
  sendJsonError(res, 429, `Too many requests. Please wait ${r.retryAfter} seconds and try again.`);
  return true;
}

function send(res, status, text, type = "text/plain") {
  res.writeHead(status, { "Content-Type": type });
  res.end(text);
}

function sendJsonError(res, status, message) {
  send(res, status, JSON.stringify({ error: { message } }), "application/json");
}

function serveFile(req, res, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return send(res, 400, "Bad request");
  }
  if (decoded.includes("\0")) return send(res, 400, "Bad request");
  const rel = decoded === "/" ? "index.html" : decoded;
  const filePath = path.resolve(PUBLIC_DIR, "." + path.sep + rel);
  // Defense in depth: the resolved path must stay inside public/.
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + path.sep)) {
    return send(res, 403, "Forbidden");
  }
  try {
    const data = fs.readFileSync(filePath);
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[path.extname(filePath)] || "application/octet-stream",
    });
    res.end(req.method === "HEAD" ? undefined : data);
  } catch {
    send(res, 404, "Not found");
  }
}

// Forward only validated fields. The key is added here and never sent to the browser.
async function proxyToOpenRouter(reqBody) {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": ALLOWED_ORIGIN,
      "X-Title": "RA Practice Scenarios",
    },
    body: JSON.stringify(reqBody),
    signal: AbortSignal.timeout(60000),
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, ok: response.ok, data };
}

function readBody(req, res, onDone, maxBytes = MAX_BODY_BYTES) {
  const chunks = [];
  let size = 0;
  let tooBig = false;
  req.on("data", chunk => {
    if (tooBig) return;
    size += chunk.length;
    if (size > maxBytes) {
      tooBig = true;
      sendJsonError(res, 413, "Request body too large");
      return;
    }
    chunks.push(chunk);
  });
  req.on("error", () => {
    if (!res.headersSent) sendJsonError(res, 400, "Request failed");
  });
  req.on("end", () => { if (!tooBig) onDone(Buffer.concat(chunks).toString("utf-8")); });
}

const server = http.createServer((req, res) => {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);

  // Health check for the host platform. Before the Host check because probes use internal hostnames. No secrets.
  if ((req.method === "GET" || req.method === "HEAD") && req.url.split("?")[0] === "/healthz") {
    return send(res, 200, JSON.stringify({ ok: true, commit: DEPLOY_COMMIT }), "application/json");
  }

  const origin = req.headers.origin;

  // Only the app's own origin may call us. Browsers always send Origin on cross-site requests.
  if (origin !== undefined && !isOriginAllowed(origin, PORT, PUBLIC_ORIGINS)) {
    return sendJsonError(res, 403, "Origin not allowed");
  }
  // Reject unexpected Host headers (DNS rebinding).
  const host = req.headers.host;
  if (!isHostAllowed(host, PORT, PUBLIC_ORIGINS)) {
    return sendJsonError(res, 403, "Host not allowed");
  }
  if (origin !== undefined) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }

  if (req.method === "OPTIONS") {
    if (origin !== undefined) {
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    }
    res.writeHead(204);
    res.end();
    return;
  }

  let pathname;
  try {
    pathname = new URL(req.url, ALLOWED_ORIGIN).pathname;
  } catch {
    return send(res, 400, "Bad request");
  }

  if (pathname === "/api/chat") {
    if (req.method !== "POST") return sendJsonError(res, 405, "Method not allowed");
    if (!LIVE_AI_ENABLED) {
      return sendJsonError(res, 503, "Live AI is turned off on this server right now. Try the practice demo at ?mock=1 instead.");
    }
    if (refusedByRateLimit(req, res)) return;
    if (dailyCap.reached()) {
      return sendJsonError(res, 503, "The daily limit for AI calls has been reached. Please try again tomorrow.");
    }
    return readBody(req, res, async text => {
      let input;
      try {
        input = JSON.parse(text);
      } catch {
        return sendJsonError(res, 400, "Invalid JSON");
      }
      const { clean, error } = validateChatBody(input, ALLOWED_MODELS);
      if (error) return sendJsonError(res, 400, error);
      if (dailyCap.reached()) {
        return sendJsonError(res, 503, "The daily limit for AI calls has been reached. Please try again tomorrow.");
      }
      dailyCap.count();
      try {
        const { status, ok, data } = await proxyToOpenRouter(clean);
        if (!ok) {
          const msg = data.error?.message || `OpenRouter error: ${status}`;
          console.error("Upstream error:", status, msg);
          return sendJsonError(res, status, msg);
        }
        send(res, 200, JSON.stringify(data), "application/json");
      } catch (err) {
        console.error("Proxy error:", err.message);
        sendJsonError(res, err.name === "TimeoutError" ? 504 : 502, "Upstream request failed");
      }
    });
  }

  if (pathname === "/api/transcript") {
    if (req.method !== "POST") return sendJsonError(res, 405, "Method not allowed");
    if (IS_PREVIEW) return sendJsonError(res, 503, "Saving sessions is turned off in pull request previews.");
    if (refusedByRateLimit(req, res)) return;
    return readBody(req, res, text => {
      const { record, error, status } = validateTranscript(text, { key: OPENROUTER_API_KEY, gitCommit: GIT_COMMIT });
      if (error) return sendJsonError(res, status, error);
      try {
        const file = saveTranscript(record, LIVE_DIR);
        send(res, 200, JSON.stringify({ ok: true, file }), "application/json");
      } catch (err) {
        console.error("Transcript save error:", err.message);
        sendJsonError(res, 500, "Could not save transcript");
      }
    }, MAX_TRANSCRIPT_BYTES);
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    return send(res, 405, "Method not allowed");
  }
  serveFile(req, res, pathname);
});

const HOST = PRODUCTION ? "0.0.0.0" : "127.0.0.1";
server.listen(PORT, HOST, () => {
  console.log(`Server running at ${ALLOWED_ORIGIN} (listening on ${HOST}:${PORT}, live AI ${LIVE_AI_ENABLED ? "on" : "off"}${IS_PREVIEW ? ", pull request preview, saving off" : ""})`);
});

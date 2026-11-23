import http from "http";
import fs from "fs";
import path from "path";
import { URL } from "url";
import { isOriginAllowed, isHostAllowed, parsePublicOrigins, previewOrigins } from "./origins.mjs";
import { createRateLimiter, createDailyCap, envNumber, envFlag } from "./limits.mjs";
import { execSync } from "child_process";
import { validateChatBody, sendToOpenRouter } from "./chatBody.mjs";
import { MAX_TRANSCRIPT_BYTES } from "./liveTranscript.mjs";
import { readSetting, normalizeDatabaseUrl, createVerifier } from "./auth.mjs";
import { createApiRoutes } from "./apiRoutes.mjs";

const PORT = Number(process.env.PORT) || 3000;
const PRODUCTION = process.env.NODE_ENV === "production";
const PUBLIC_ORIGINS = parsePublicOrigins(process.env.PUBLIC_ORIGIN);
// On a Render preview only, also accept the preview's own hostname from the environment.
const ACCEPTED_ORIGINS = [...PUBLIC_ORIGINS, ...previewOrigins(process.env)];
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
  "meta-llama/llama-3.3-70b-instruct",
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

// DATABASE_URL and GOOGLE_CLIENT_ID: environment first, then .env. Never logged.
// The .env.example placeholder counts as "not set", so a fresh copy of it keeps the file fallback.
let DATABASE_URL = "";
try {
  DATABASE_URL = normalizeDatabaseUrl(readSetting("DATABASE_URL", process.env, envPath));
} catch (e) {
  console.error("[config]", e.message);
  process.exit(1);
}
const GOOGLE_CLIENT_ID = readSetting("GOOGLE_CLIENT_ID", process.env, envPath);
const verifyUser = createVerifier({ clientId: GOOGLE_CLIENT_ID, allowedDomain: (process.env.ALLOWED_GOOGLE_DOMAIN || "").trim() });
let sqlPromise = null;
// Without DATABASE_URL, query is null and sessions go to transcripts/live/ as before.
const query = DATABASE_URL
  ? async (text, params) => {
      sqlPromise ||= import("@neondatabase/serverless").then(m => m.neon(DATABASE_URL));
      try {
        return await (await sqlPromise).query(text, params);
      } catch (e) {
        sqlPromise = null; // do not keep a failed load for the life of the process
        const safe = new Error(String(e && e.message || e).split(DATABASE_URL).join("[redacted]"));
        safe.name = String(e && e.name || "Error"); // keep the name (e.g. NeonDbError) for the log
        throw safe;
      }
    }
  : null;
console.log(`[startup] session saving: ${query ? "database mode (sessions table)" : "file mode (transcripts/live/)"}`);
const routes = createApiRoutes({
  verifyUser, query, dailyCap, liveAiEnabled: LIVE_AI_ENABLED, key: OPENROUTER_API_KEY, gitCommit: GIT_COMMIT, liveDir: LIVE_DIR,
  userCallsPerHour: envNumber(process.env.USER_CALLS_PER_HOUR, 150),
  userSessionsPerDay: envNumber(process.env.USER_SESSIONS_PER_DAY, 10),
});

function sendRoute(res, r) {
  for (const [k, v] of Object.entries(r.headers || {})) res.setHeader(k, v);
  send(res, r.status, JSON.stringify(r.body), "application/json");
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
  return sendToOpenRouter(reqBody, { key: OPENROUTER_API_KEY, referer: ALLOWED_ORIGIN });
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
  if (origin !== undefined && !isOriginAllowed(origin, PORT, ACCEPTED_ORIGINS)) {
    return sendJsonError(res, 403, "Origin not allowed");
  }
  // Reject unexpected Host headers (DNS rebinding).
  const host = req.headers.host;
  if (!isHostAllowed(host, PORT, ACCEPTED_ORIGINS)) {
    return sendJsonError(res, 403, "Host not allowed");
  }
  if (origin !== undefined) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }

  if (req.method === "OPTIONS") {
    if (origin !== undefined) {
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
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

  if (pathname === "/config.json" && (req.method === "GET" || req.method === "HEAD")) {
    return send(res, 200, JSON.stringify({ googleClientId: GOOGLE_CLIENT_ID }), "application/json");
  }

  if (pathname === "/api/chat") {
    if (req.method !== "POST") return sendJsonError(res, 405, "Method not allowed");
    if (!LIVE_AI_ENABLED) {
      return sendJsonError(res, 503, "Live AI is turned off on this server right now. Try the practice demo at ?mock=1 instead.");
    }
    if (refusedByRateLimit(req, res)) return;
    // Order: per IP limit (above), then login, then per user limit, then the daily cap. Only a logged in call is counted.
    return routes.guardChat(req.headers).then(refused => {
      if (refused) return sendRoute(res, refused);
      readBody(req, res, async text => {
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
    });
  }

  if (pathname === "/api/transcript" || pathname.startsWith("/api/sessions")) {
    if (IS_PREVIEW && pathname === "/api/transcript") return sendJsonError(res, 503, "Saving sessions is turned off in pull request previews.");
    if (pathname === "/api/transcript" && req.method !== "POST") return sendJsonError(res, 405, "Method not allowed");
    if (refusedByRateLimit(req, res)) return;
    const run = text => routes.handle({ method: req.method, pathname, headers: req.headers, text })
      .then(r => (r ? sendRoute(res, r) : send(res, 404, "Not found")))
      .catch(err => {
        console.error("Route error:", pathname.split("/").slice(0, 3).join("/"), String(err.message || err).split(DATABASE_URL || "\0").join("[redacted]"));
        if (!res.headersSent) sendJsonError(res, 500, "Request failed");
      });
    if (pathname === "/api/transcript") return readBody(req, res, run, MAX_TRANSCRIPT_BYTES);
    return run("");
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

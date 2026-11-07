import http from "http";
import fs from "fs";
import path from "path";
import { URL } from "url";

const PORT = Number(process.env.PORT) || 3000;
const ALLOWED_ORIGIN = `http://localhost:${PORT}`;
const MAX_BODY_BYTES = 64 * 1024;
const MAX_TOKENS_CAP = 1000;

// Keep in sync with public/app.js (MAIN_MODEL, GRADER_MODELS, CONSOLIDATOR_MODEL). The two lists must match.
const ALLOWED_MODELS = new Set([
  "deepseek/deepseek-chat",
  "anthropic/claude-haiku-5.5",
  "google/gemini-2.5-flash",
]);

// Load API key from .env — must exist
const envPath = path.join(process.cwd(), ".env");
let OPENROUTER_API_KEY = null;
if (fs.existsSync(envPath)) {
  const envText = fs.readFileSync(envPath, "utf-8");
  const match = envText.match(/^OPENROUTER_API_KEY=(.+)$/m);
  if (match) OPENROUTER_API_KEY = match[1].trim();
}

if (!OPENROUTER_API_KEY) {
  console.error("ERROR: OPENROUTER_API_KEY not found in .env");
  process.exit(1);
}

const MIME_TYPES = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
};

const PUBLIC_DIR = path.resolve(process.cwd(), "public");

function send(res, status, text, type = "text/plain") {
  res.writeHead(status, { "Content-Type": type, "X-Content-Type-Options": "nosniff" });
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
      "X-Content-Type-Options": "nosniff",
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

function readBody(req, res, onDone) {
  const chunks = [];
  let size = 0;
  let tooBig = false;
  req.on("data", chunk => {
    if (tooBig) return;
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      tooBig = true;
      sendJsonError(res, 413, "Request body too large");
      return;
    }
    chunks.push(chunk);
  });
  req.on("end", () => { if (!tooBig) onDone(Buffer.concat(chunks).toString("utf-8")); });
}

const server = http.createServer((req, res) => {
  const origin = req.headers.origin;

  // Only the app's own origin may call us. Browsers always send Origin on cross-site requests.
  if (origin !== undefined && origin !== ALLOWED_ORIGIN) {
    return sendJsonError(res, 403, "Origin not allowed");
  }
  // Reject unexpected Host headers (DNS rebinding).
  const host = req.headers.host;
  if (host !== `localhost:${PORT}` && host !== `127.0.0.1:${PORT}`) {
    return sendJsonError(res, 403, "Host not allowed");
  }
  if (origin === ALLOWED_ORIGIN) {
    res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
    res.setHeader("Vary", "Origin");
  }

  if (req.method === "OPTIONS") {
    if (origin === ALLOWED_ORIGIN) {
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
    return readBody(req, res, async text => {
      let input;
      try {
        input = JSON.parse(text);
      } catch {
        return sendJsonError(res, 400, "Invalid JSON");
      }
      if (!input || typeof input !== "object" || Array.isArray(input)) {
        return sendJsonError(res, 400, "Invalid request");
      }
      if (typeof input.model !== "string" || !ALLOWED_MODELS.has(input.model)) {
        return sendJsonError(res, 400, "Model not allowed");
      }
      if (!Array.isArray(input.messages) || input.messages.length === 0) {
        return sendJsonError(res, 400, "messages must be a non-empty array");
      }
      const maxTokens = Number.isFinite(input.max_tokens) && input.max_tokens > 0
        ? Math.min(Math.floor(input.max_tokens), MAX_TOKENS_CAP)
        : 200;
      const clean = { model: input.model, messages: input.messages, max_tokens: maxTokens };
      if (Number.isFinite(input.temperature)) {
        clean.temperature = Math.min(Math.max(input.temperature, 0), 2);
      }
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

  if (req.method !== "GET" && req.method !== "HEAD") {
    return send(res, 405, "Method not allowed");
  }
  serveFile(req, res, pathname);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Server running at ${ALLOWED_ORIGIN}`);
});

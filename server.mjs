import http from "http";
import fs from "fs";
import path from "path";
import { URL } from "url";

const PORT = 3000;

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

function serveFile(res, filePath) {
  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || "application/octet-stream";
  try {
    const data = fs.readFileSync(filePath);
    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  }
}

async function proxyToOpenRouter(reqBody) {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "http://localhost:3000",
      "X-Title": "RA Practice Scenarios",
    },
    body: JSON.stringify(reqBody),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error?.message || `OpenRouter error: ${response.status}`);
  }
  return data;
}

const server = http.createServer(async (req, res) => {
  // CORS headers for local dev
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url, `http://localhost:${PORT}`);

  // Proxy API calls
  if (parsedUrl.pathname === "/api/chat" && req.method === "POST") {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", async () => {
      try {
        const reqBody = JSON.parse(body);
        const data = await proxyToOpenRouter(reqBody);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(data));
      } catch (err) {
        console.error("Proxy error:", err.message);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // Static files from /public
  let filePath = parsedUrl.pathname === "/"
    ? path.join(process.cwd(), "public", "index.html")
    : path.join(process.cwd(), "public", parsedUrl.pathname);

  serveFile(res, filePath);
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});

// Validates the body of POST /api/chat and builds what is forwarded to OpenRouter.
// Pure function so tests can import it without starting the server.

export const MAX_TOKENS_CAP = 2000;

// Returns a clean reasoning object, or null if the shape is not one we allow.
// Allowed: { enabled: boolean } or { effort: "low"|"medium"|"high" } or { max_tokens: 1..MAX_TOKENS_CAP }.
// Exactly one key; anything else is rejected.
export function cleanReasoning(r) {
  if (!r || typeof r !== "object" || Array.isArray(r)) return null;
  const keys = Object.keys(r);
  if (keys.length !== 1) return null;
  const [k] = keys;
  if (k === "enabled" && typeof r.enabled === "boolean") return { enabled: r.enabled };
  if (k === "effort" && ["low", "medium", "high"].includes(r.effort)) return { effort: r.effort };
  if (k === "max_tokens" && Number.isInteger(r.max_tokens) && r.max_tokens >= 1 && r.max_tokens <= MAX_TOKENS_CAP) {
    return { max_tokens: r.max_tokens };
  }
  return null;
}

// Returns { clean } on success or { error: "message" } (HTTP 400) on failure.
export function validateChatBody(input, allowedModels) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { error: "Invalid request" };
  if (typeof input.model !== "string" || !allowedModels.has(input.model)) return { error: "Model not allowed" };
  if (!Array.isArray(input.messages) || input.messages.length === 0) return { error: "messages must be a non-empty array" };
  const maxTokens = Number.isFinite(input.max_tokens) && input.max_tokens > 0
    ? Math.min(Math.floor(input.max_tokens), MAX_TOKENS_CAP)
    : 200;
  const clean = { model: input.model, messages: input.messages, max_tokens: maxTokens };
  if (Number.isFinite(input.temperature)) {
    clean.temperature = Math.min(Math.max(input.temperature, 0), 2);
  }
  if (input.reasoning !== undefined) {
    const reasoning = cleanReasoning(input.reasoning);
    if (!reasoning) return { error: "Invalid reasoning setting" };
    clean.reasoning = reasoning;
  }
  return { clean };
}

// Zero data retention. On unless OPENROUTER_ZDR is false/0/no/off. Read from the server environment only.
export function zdrEnabled(env = process.env) {
  const v = String(env.OPENROUTER_ZDR ?? "").trim().toLowerCase();
  return !["false", "0", "no", "off"].includes(v);
}

// The one place the OpenRouter body is built. The provider field is set here, never taken from the browser.
export function buildOpenRouterBody(clean, env = process.env) {
  if (!zdrEnabled(env)) return { ...clean };
  return { ...clean, provider: { zdr: true, data_collection: "deny" } };
}

// The one place the OpenRouter request is sent. Used by server.mjs and tools/zdrcheck.mjs.
export async function sendToOpenRouter(clean, { key, referer, env = process.env, timeoutMs = 60000 }) {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${key}`,
      "Content-Type": "application/json",
      "HTTP-Referer": referer,
      "X-Title": "RA Practice Scenarios",
    },
    body: JSON.stringify(buildOpenRouterBody(clean, env)),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, ok: response.ok, data };
}

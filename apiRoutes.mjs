// Auth-protected API logic: /api/transcript, /api/sessions, and the per user chat limit.
// No HTTP here: server.mjs reads the body and writes the response. Tests pass stubs for verifyUser and query.
// query(text, params) -> rows[]. It is null when DATABASE_URL is not set (files in transcripts/live/ are used then).
import { validateTranscript, saveTranscript } from "./liveTranscript.mjs";
import { createRateLimiter } from "./limits.mjs";
import { VOICE_IDS, MAX_TTS_CHARS } from "./public/config.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIST_COLUMNS = "id, scenario_id, topic, difficulty, started_at, ended_at, turns, met, models, app_version, created_at";
const err = (status, message, headers) => ({ status, body: { error: { message } }, headers });
const ok = (body, status = 200) => ({ status, body });
// Error name and message only, with any connection string removed. Used for the [save-failed] log line.
const safeError = e => [String(e && e.name || "Error"), String(e && e.message || e).replace(/postgres(?:ql)?:\/\/\S*/gi, "[redacted]")];

export function createApiRoutes({
  verifyUser, query = null, dailyCap = null, liveAiEnabled = false, key = "", gitCommit = "unknown", liveDir = "transcripts/live",
  userCallsPerHour = 150, userSessionsPerDay = 10, voiceEnabled = false, tts = null, saveFile = saveTranscript, log = console.error,
}) {
  const userChat = createRateLimiter({ max: userCallsPerHour, windowMs: 60 * 60 * 1000 });

  // Returns { id, name } or null. Reads "Authorization: Bearer <token>".
  async function authenticate(headers) {
    const m = /^Bearer\s+(\S+)$/i.exec(String(headers.authorization || ""));
    return m ? verifyUser(m[1]) : null;
  }
  // Practice mode per signed in user, in memory only. A user with no entry is in text mode. Voice entries expire after 12 hours.
  const MODE_TTL_MS = 12 * 60 * 60 * 1000;
  const voiceUsers = new Map(); // user id -> expiry time
  const inVoiceMode = (id, now = Date.now()) => { const t = voiceUsers.get(id); if (t === undefined) return false; if (t < now) { voiceUsers.delete(id); return false; } return true; };
  const needLogin = err(401, "Please sign in with Google to continue.");

  // For /api/chat. Returns null to go ahead, or a response to send.
  async function guardChat(headers) {
    if (!liveAiEnabled) return null;
    const user = await authenticate(headers);
    if (!user) return needLogin;
    const r = userChat.check(user.id);
    if (!r.ok) return err(429, `You have reached your hourly limit of AI calls. Please wait ${r.retryAfter} seconds and try again.`, { "Retry-After": String(r.retryAfter) });
    // Checked last and only for a logged in user, so a 401 never touches the daily cap. server.mjs counts the call.
    if (dailyCap?.reached()) return err(503, "The daily limit for AI calls has been reached. Please try again tomorrow.");
    return null;
  }

  // Every attempt logs one line: [save-ok] or [save-failed], with an error name and message only.
  // Never the connection string, token, user id or transcript text. Refusals use fixed messages.
  const failed = (name, message, response) => { log("[save-failed]", `${name}: ${message}`); return response; };

  async function saveSession(headers, text) {
    // The database needs a user, so a login is also required whenever the database is used.
    let user = null;
    if (liveAiEnabled || query) {
      user = await authenticate(headers);
      if (!user) return failed("Unauthorized", "no valid Google sign-in on the request", needLogin);
    }
    const { record, error, status } = validateTranscript(text, { key, gitCommit });
    if (error) return failed("Refused", `${status} ${error}`, err(status, error));
    try {
      if (!query) {
        const file = saveFile(record, liveDir);
        log("[save-ok]", "file mode");
        return ok({ ok: true, file });
      }
      const r = await saveToDatabase(user, record);
      if (r.status === 200) log("[save-ok]", "database mode");
      else failed("Refused", `${r.status} ${r.body.error.message}`);
      return r;
    } catch (e) {
      return failed(...safeError(e), err(500, "Could not save the session."));
    }
  }

  async function saveToDatabase(user, record) {
    const rows = await query("select count(*)::int as n from sessions where user_id = $1 and created_at > now() - interval '1 day'", [user.id]);
    if ((rows[0]?.n ?? 0) >= userSessionsPerDay) return err(429, `You can save ${userSessionsPerDay} sessions per day. Please try again tomorrow.`);
    const lines = record.transcript.map(l => (l.role === "ra" ? { ...l, sender: "RA" } : l)); // the RA is always stored as "RA"
    const times = lines.map(l => Date.parse(l.at)).filter(Number.isFinite);
    const iso = ms => (ms === undefined ? null : new Date(ms).toISOString());
    const out = await query(
      `insert into sessions (user_id, scenario_id, topic, difficulty, started_at, ended_at, turns, transcript, rubric, met, models, app_version)
       values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11::jsonb, $12) returning id`,
      [
        user.id, record.scenario_id, record.scenario, record.difficulty,
        iso(times.length ? Math.min(...times) : undefined), record.createdAt && Number.isFinite(Date.parse(record.createdAt)) ? record.createdAt : null,
        lines.filter(l => l.role === "ra").length, JSON.stringify(lines),
        JSON.stringify({ rubricVersion: record.rubricVersion ?? null, resolved: record.resolved ?? false, resolvedTurn: record.resolvedTurn ?? null, partial: !!record.partial, graders: record.graders ?? [], combined: record.combined ?? null, result: record.result ?? null, openness: record.openness ?? null, routing: record.routing ?? null, usage: record.usage ?? null }),
        Number.isInteger(record.result?.met) ? record.result.met : null,
        JSON.stringify(record.models ?? null), String(gitCommit),
      ],
    );
    return ok({ ok: true, id: out[0]?.id });
  }

  // Returns a response { status, body, headers? }, or null when the path is not one of ours.
  async function handle({ method, pathname, headers = {}, text = "" }) {
    if (pathname === "/api/transcript") {
      if (method !== "POST") return err(405, "Method not allowed");
      return saveSession(headers, text);
    }
    const m = /^\/api\/sessions(?:\/([^/]+))?$/.exec(pathname);
    if (!m) return null;
    const id = m[1];
    if (method !== "GET" && !(id && method === "DELETE")) return err(405, "Method not allowed");
    const user = await authenticate(headers);
    if (!user) return needLogin;
    if (!query) return err(503, "Saved sessions are not available on this server.");
    if (!id) {
      const rows = await query(`select ${LIST_COLUMNS} from sessions where user_id = $1 order by created_at desc limit 200`, [user.id]);
      return ok({ sessions: rows });
    }
    if (!UUID.test(id)) return err(404, "Session not found");
    if (method === "GET") {
      const rows = await query("select * from sessions where id = $1 and user_id = $2", [id, user.id]);
      return rows[0] ? ok({ session: rows[0] }) : err(404, "Session not found");
    }
    const rows = await query("delete from sessions where id = $1 and user_id = $2 returning id", [id, user.id]);
    return rows[0] ? ok({ ok: true }) : err(404, "Session not found");
  }

  // PUT /api/practice-mode { mode: "text" | "voice" }. Tells the server which mode this user is in, so /api/tts can refuse in text mode.
  async function setPracticeMode(headers, text) {
    if (!voiceEnabled) return err(503, "Voice is turned off on this server.");
    const user = await authenticate(headers);
    if (!user) return needLogin;
    let mode;
    try { mode = JSON.parse(text)?.mode; } catch { return err(400, "Invalid JSON"); }
    if (mode !== "text" && mode !== "voice") return err(400, 'mode must be "text" or "voice"');
    if (mode === "voice") {
      if (voiceUsers.size >= 10000) for (const [k, t] of voiceUsers) if (t < Date.now()) voiceUsers.delete(k);
      voiceUsers.set(user.id, Date.now() + MODE_TTL_MS);
    } else voiceUsers.delete(user.id);
    return ok({ ok: true, mode });
  }

  // POST /api/tts { text, resident }. Same sign in, per user limit and daily cap as /api/chat.
  // Order: live AI on, provider set, login, voice mode, per user limit, daily cap, body checks. Only a valid call counts toward the daily cap.
  // The text and the audio are never logged or stored. The voice id comes from config.js, never from the request.
  async function speak(headers, text) {
    if (!voiceEnabled) return err(503, "Voice is turned off on this server.");
    if (!liveAiEnabled) return err(503, "Live AI is turned off on this server right now.");
    if (!tts) return err(503, "Read-aloud is not set up on this server.");
    const user = await authenticate(headers);
    if (!user) return needLogin;
    if (!inVoiceMode(user.id)) return err(409, "Voice mode is off. Choose Voice when you start a session to use read-aloud.");
    const r = userChat.check(user.id);
    if (!r.ok) return err(429, `You have reached your hourly limit of AI calls. Please wait ${r.retryAfter} seconds and try again.`, { "Retry-After": String(r.retryAfter) });
    if (dailyCap?.reached()) return err(503, "The daily limit for AI calls has been reached. Please try again tomorrow.");
    let input;
    try { input = JSON.parse(text); } catch { return err(400, "Invalid JSON"); }
    const body = input && typeof input === "object" && !Array.isArray(input) ? input : {};
    if (typeof body.text !== "string" || body.text.trim().length === 0) return err(400, "text must be a non-empty string");
    if (body.text.length > MAX_TTS_CHARS) return err(400, `text must be at most ${MAX_TTS_CHARS} characters`);
    if (!Object.hasOwn(VOICE_IDS, body.resident)) return err(400, 'resident must be "alex" or "jordan"');
    dailyCap?.count();
    try {
      const audio = await tts.synthesize({ text: body.text.trim(), voiceId: VOICE_IDS[body.resident] });
      return { status: 200, audio, headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } };
    } catch (e) {
      log("[tts-failed]", String(e && e.name || "Error")); // the name only: never the text or the message
      return err(502, "Read-aloud failed. The text is still shown.");
    }
  }

  return { authenticate, guardChat, handle, setPracticeMode, speak };
}

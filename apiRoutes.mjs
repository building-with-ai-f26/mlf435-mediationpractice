// Auth-protected API logic: /api/transcript, /api/sessions, and the per user chat limit.
// No HTTP here: server.mjs reads the body and writes the response. Tests pass stubs for verifyUser and query.
// query(text, params) -> rows[]. It is null when DATABASE_URL is not set (files in transcripts/live/ are used then).
import { validateTranscript, saveTranscript } from "./liveTranscript.mjs";
import { createRateLimiter } from "./limits.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIST_COLUMNS = "id, scenario_id, topic, difficulty, started_at, ended_at, turns, met, models, app_version, created_at";
const err = (status, message, headers) => ({ status, body: { error: { message } }, headers });
const ok = (body, status = 200) => ({ status, body });

export function createApiRoutes({
  verifyUser, query = null, dailyCap = null, liveAiEnabled = false, key = "", gitCommit = "unknown", liveDir = "transcripts/live",
  userCallsPerHour = 150, userSessionsPerDay = 10, saveFile = saveTranscript,
}) {
  const userChat = createRateLimiter({ max: userCallsPerHour, windowMs: 60 * 60 * 1000 });

  // Returns { id, name } or null. Reads "Authorization: Bearer <token>".
  async function authenticate(headers) {
    const m = /^Bearer\s+(\S+)$/i.exec(String(headers.authorization || ""));
    return m ? verifyUser(m[1]) : null;
  }
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

  async function saveSession(headers, text) {
    // The database needs a user, so a login is also required whenever the database is used.
    let user = null;
    if (liveAiEnabled || query) {
      user = await authenticate(headers);
      if (!user) return needLogin;
    }
    const { record, error, status } = validateTranscript(text, { key, gitCommit });
    if (error) return err(status, error);
    if (!query) return ok({ ok: true, file: saveFile(record, liveDir) });

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
        JSON.stringify({ rubricVersion: record.rubricVersion ?? null, partial: !!record.partial, graders: record.graders ?? [], combined: record.combined ?? null, result: record.result ?? null, openness: record.openness ?? null, routing: record.routing ?? null, usage: record.usage ?? null }),
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

  return { authenticate, guardChat, handle };
}

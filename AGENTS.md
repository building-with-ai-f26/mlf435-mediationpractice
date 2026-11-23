# AGENTS.md — Coding Agent Operating Manual

> Give this file to your coding agent and check that it is using these instructions. Keep the stack, commands, and ground rules current.

## 1. Project Overview
- **What this repo builds:** A local web application that lets Resident Assistants practice mediating roommate conflicts with AI residents. The RA picks a topic and difficulty, mediates between two AI roommates via text (voice in v2), and receives a graded debrief from 3 AI models.
- **Primary user & core workflow:** A current RA on the builder's Housing Team. Workflow: setup (name, topic, difficulty) → context cards → Alex introduces → Jordan introduces → RA mediates (turn-based) → end session → 3 AI graders answer a 15-question yes/no rubric; code verifies quotes, votes and scores.
- **Tech stack:** Node.js 20+ (built-in `http` module) / Vanilla HTML+CSS+JS / OpenRouter API (Claude Haiku 5.5 for residents, tagger and router; Claude, Gemini and GPT graders)

## 2. Commands
All commands run from the repository root with Node 20 or newer. There is no `package.json` and no `npm install`; the project uses only Node built-ins.

- **Clean clone setup:**
  ```bash
  git clone <your-repo-url>
  cd <your-repo-name>
  node --version                # must print v20 or newer
  cp .env.example .env          # then edit .env and replace the placeholder with your OpenRouter key
  ```
- **Start the server:** `LIVE_AI_ENABLED=true node server.mjs` (or `npm start`), then open `http://localhost:3000`. Without `LIVE_AI_ENABLED=true`, `/api/chat` returns 503 and only `?mock=1` works. The key is read from the `OPENROUTER_API_KEY` environment variable first, then from `.env` in the current directory; the server exits with an error if neither has it. It listens on `127.0.0.1`, or on `0.0.0.0` when `NODE_ENV=production`. See "Server environment variables" below.
- **Run offline (no API calls):** open `http://localhost:3000/?mock=1`. The browser uses canned replies and grades. The server still has to start, so `.env` needs a key line even in mock mode.
- **Run tests:** `node --test tests/*.test.mjs` (or `npm test`). Deterministic and offline: 290 tests in 30 files. The live-transcript test starts `server.mjs` on a random local port in a temporary folder.
- **Probe grader models:** `node tools/probe-models.mjs [--dry]`. Sends one fixed grading prompt to the three grader models with two settings each (six calls, billed to your key). `--dry` prints the planned requests and makes no network calls. The prompt is out of date; see section 11.
- **Simulate sessions:** `node tools/simulate.mjs [flags]`. Runs whole sessions (residents, simulated RA, tagger, three graders) directly against OpenRouter, not the local server. Live runs cost money and save one transcript per session under `transcripts/`. Flags, all optional:

  | Flag | Default | Values |
  |---|---|---|
  | `--scenario` | `noise` | `noise`, `cleaning`, `guest policy`, `hygiene`, `shared items`, `religious practice` |
  | `--difficulty` | `medium` | `easy`, `medium`, `hard` |
  | `--persona` | `all` | `all`, or one of `strong`, `rushed-good`, `average`, `solution-pusher`, `side-taker`, `minimal`, `typo-good`, `nickname-both`, `hostile`, `injection` |
  | `--runs` | `1` | whole number of at least 1, runs per persona |
  | `--max-turns` | `8` | whole number of at least 1. Currently has no effect; see section 11 |
  | `--ra-model` | `deepseek/deepseek-chat` | any OpenRouter model id for the simulated RA. Not checked against the server allowlist, because the tool calls OpenRouter directly |
  | `--max-cost` | `1.00` | US dollars. Stops before the next call once known spend exceeds it |
  | `--out` | `transcripts` | folder for saved transcripts and `index.csv` |
  | `--dry` | off | no network; scripted RA lines and canned grader replies. Saves nothing unless `--out` is also given |

  There is no `--help`. An unknown flag or bad value exits with an error. Safe check: `node tools/simulate.mjs --persona strong --dry`.
- **Report saved runs:** `node tools/report.mjs [--dir transcripts] [--include-dry]`. Reads every saved transcript and prints: score by persona against its expected range, mean count by grader, YES answers the evidence check changed, grader disagreement, and mean cost. Dry-run records are skipped unless `--include-dry` is given. No `--help`.
- **Export live sessions for sharing:** `node tools/export-live.mjs <file or folder>... [--out transcripts/shared] [--name <RA name>]`. Copies live session files from `transcripts/live/` to `transcripts/shared/` with every line that looks like an email address or phone number removed, and the RA name replaced by "RA" if `--name` is given. Skips files that are not live sessions or that contain `sk-or-`. Only files in `transcripts/shared/` may be committed. Read them before committing: the redaction is pattern based.
- **Sync the hosted demo:** `scripts/sync-demo.sh`. Deletes and rebuilds `docs/demo/` as a copy of `public/` for GitHub Pages. No flags. Commit `docs/demo/` after any change in `public/`.
- **Run model evals:** Manual end-to-end session and debrief checks, plus `tools/simulate.mjs` and `tools/report.mjs` as above. See `tests/README.md` for the Build 4 tracks.

### Server environment variables
All except the key are read from the process environment only (not from `.env`). Also listed in `.env.example`.

| Variable | Default | Meaning |
|---|---|---|
| `OPENROUTER_API_KEY` | none, required | Read from the environment first, then `.env`. Never logged. |
| `PORT` | `3000` | Listen port. |
| `NODE_ENV` | unset | `production` binds `0.0.0.0` and uses the first `x-forwarded-for` entry as the client IP. Anything else binds `127.0.0.1` and uses the socket address. |
| `PUBLIC_ORIGIN` | empty | Comma separated origins (e.g. `https://ra.example.edu`) accepted as Origin, and their hosts accepted as Host, in addition to localhost and 127.0.0.1. |
| `LIVE_AI_ENABLED` | `false` | `true`, `1`, `yes` or `on` enables `/api/chat`. Otherwise it returns 503 with a readable message, which the app shows. |
| `RATE_LIMIT_MAX` | `60` | Requests per client IP per window on `/api/chat` and `/api/transcript` (one shared count). Over the limit: 429 with `Retry-After`. In memory, reset on restart. |
| `RATE_LIMIT_WINDOW_MINUTES` | `10` | Length of that window. |
| `DAILY_CALL_CAP` | `500` | Global count of valid `/api/chat` calls per UTC day. Once reached: 503. In memory, reset on restart. |
| `GOOGLE_CLIENT_ID` | none | Read from the environment first, then `.env`. The Google OAuth client id that ID tokens must be issued for. Served to the browser at `/config.json`. It is public, not a secret. Without it nobody can sign in. |
| `ALLOWED_GOOGLE_DOMAIN` | empty | Optional, environment only. When set, a token is accepted only if `email_verified` is true and its `hd` claim equals this domain. |
| `USER_CALLS_PER_HOUR` | `150` | Per signed in user, `/api/chat` calls per hour. Over the limit: 429 with `Retry-After`. In memory, reset on restart. |
| `USER_SESSIONS_PER_DAY` | `10` | Per user, saved sessions per rolling 24 hours, counted from the `sessions` table. Over the limit: 429. Only applies when the database is used. |
| `RESIDENT_MODEL` | `anthropic/claude-haiku-5.5` | Model that plays Alex and Jordan. Must have a zero data retention route. Added to the server allowlist automatically. Served to the browser in `/config.json`. |
| `GRADER_1_MODEL`, `GRADER_2_MODEL`, `GRADER_3_MODEL` | `anthropic/claude-haiku-5.5`, `google/gemini-3.1-flash-lite`, `openai/gpt-6-luna` | The three graders (three vendors). All turn reasoning off. A model with mandatory reasoning (Gemini 3.6 Flash) will fail on the 1,500 token limit. |
| `TAGGER_MODEL`, `ROUTER_MODEL` | `anthropic/claude-haiku-5.5` | Tagger and router. |
| `VOICE_ENABLED` | `false` | Turns on voice: the practice mode setting (Text or Voice) in the browser and the `/api/tts` and `/api/practice-mode` routes. Off by default: the routes return 503 and the browser shows no setting. Environment only. |
| `STT_PROVIDER` | `stub` | Push-to-talk provider. `stub` returns canned text, `off` or `none` turns voice input off (`/api/stt` returns 503). Unknown names and retired voice models are refused. Environment only. |
| `TTS_PROVIDER` | empty | Read-aloud provider. Empty means off (`/api/tts` returns 503). `stub` returns silent audio for tests and local trials. An unknown name turns read-aloud off with a log line. The real provider is not chosen yet; add it in `tts.mjs`. Environment only. |
| `DATABASE_URL` | empty | Read from the environment first, then `.env`. Neon Postgres connection string, a secret. The `.env.example` placeholder counts as not set. When empty, sessions are saved as files in `transcripts/live/` as before. Never log it, never commit it, and never use the production string on a dev machine. |

**Server-side auth.** Every call to `/api/chat`, `/api/transcript` and `/api/sessions` needs `Authorization: Bearer <Google ID token>`. `auth.mjs` verifies the token itself with `node:crypto`: RS256 signature against Google's public keys (cached for an hour), issuer, `aud` equal to `GOOGLE_CLIENT_ID`, expiry, and optionally the domain. The user id is the token's `sub`. A missing or bad token gets 401 `Please sign in with Google to continue.` The token is never logged. `GET /config.json` returns `googleClientId` and the model ids (`residentModel`, `graderModels`, `taggerModel`, `routerModel`) and nothing else. The browser decodes the token only to show `given_name`; it never trusts it.

**Order of checks on `/api/chat`:** live AI on (else 503), per IP limit (429), login (401), per user hourly limit (429), global daily cap (503). Only a logged in call counts toward the daily cap. A failed login never uses up anyone's quota.

**Sessions routes** (`apiRoutes.mjs`), all need login, all scoped to the signed in user's `user_id`:
- `POST /api/transcript` saves one session. With `DATABASE_URL` it inserts a row in `sessions` (schema in `migrations/0001_sessions.sql`), the RA is always stored as "RA", and the per user daily limit applies. Without it, it writes a file under `transcripts/live/` as before. Refuses bodies containing `sk-or-`, the loaded key, `npg_...` or a `postgres://user:password@` string, more than 500 lines, or an over long scenario or difficulty.
- `GET /api/sessions` lists the user's 200 newest sessions (no transcript text). `GET /api/sessions/<uuid>` returns one. `DELETE /api/sessions/<uuid>` deletes one. Another user's id returns 404, the same as a missing one. These return 503 when `DATABASE_URL` is not set. The browser does not call them yet.

**Voice input (`POST /api/stt`), only when `VOICE_ENABLED` is true (else 503).** The body is the audio itself (at most 512 KB, 30 seconds declared in `X-Clip-Seconds`, `Content-Type` one of webm, ogg, mp4, mpeg, wav), the reply is `{text}`. Same order of checks as `/api/tts`, same limits and cap, same 409 outside Voice mode. The audio stays in memory and is never saved, logged or written to a temp file. The provider does not stream yet: words appear after the clip. Retired voice models (OpenAI `tts-1`, `tts-1-hd`, `gpt-4o-mini-tts`, `gpt-realtime-mini`, Gemini 3.1 Flash Live Preview) are refused by name. The browser side (hold the microphone button, edit the words, send) is in `public/app.js`; it has no browser test.

**Read-aloud (`tts.mjs`, `apiRoutes.mjs`), only when `VOICE_ENABLED` is true.** `PUT /api/practice-mode {mode: "text"|"voice"}` tells the server which mode the signed in user is in (in memory, per user, 12 hour expiry, default text). `POST /api/tts {text, resident}` (text at most 600 characters, resident `alex` or `jordan`) returns `audio/mpeg`. Order: live AI on (503), provider set (503), login (401), voice mode (409), per user hourly limit shared with `/api/chat` (429), daily cap shared with `/api/chat` (503), body checks (400). The voice id comes from `VOICE_IDS` in `public/config.js`, never from the request. The text and the audio are never stored or logged. Both routes need the per IP limit and a body of at most 4 KB. Practice mode never reaches the saved record, the graders or the model prompts. In the browser, `public/voice.js` holds the mode setting (remembered in `localStorage`), the pacing helpers and the live message line that push-to-talk will reuse.

`GET /healthz` returns `200 {"ok":true,"commit":"<sha>"}` and nothing else. The commit is `RENDER_GIT_COMMIT` on Render, else the local short git hash, else `unknown`. When `IS_PULL_REQUEST` is `true` (a Render preview) the server forces live AI off and `/api/transcript` returns 503 without writing. Every response carries `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` and `Referrer-Policy: strict-origin-when-cross-origin`. There is no Content-Security-Policy yet because the PostHog snippet is inline.

## 3. Architecture
- `server.mjs` — Node `http` server on `127.0.0.1`. Serves `public/` (GET and HEAD only) and forwards `POST /api/chat` to OpenRouter, adding the key from `.env`. Rejects models not in `ALLOWED_MODELS`, bodies over 64 KB, and requests with an unexpected Origin or Host.
- `chatBody.mjs` — Validates the `/api/chat` body: model allowlist, non-empty messages, `max_tokens` (capped at 2000), temperature clamp, `reasoning` shape. Imported by `server.mjs`.
- `liveTranscript.mjs` — Validates and saves one live session for `POST /api/transcript`: 200 KB cap, refuses `sk-or-` and the loaded key, keeps only known fields, adds `source: "live"` and the git commit, writes the file and the index row. Imported by `server.mjs` and tests.
- `origins.mjs` — The allowed origins and hosts: `localhost` and `127.0.0.1` on the server port, plus `PUBLIC_ORIGIN`. Imported by `server.mjs`.
- `limits.mjs` — In-memory rate limiter (used per IP and per user), daily call cap and env parsing helpers. Imported by `server.mjs`, `apiRoutes.mjs` and tests.
- `auth.mjs` — Google ID token verification (`createVerifier`) and `readSetting` (environment, then `.env`). No dependencies. Imported by `server.mjs` and tests.
- `apiRoutes.mjs` — Login check, per user chat limit, and the `/api/transcript` and `/api/sessions` logic. No HTTP in it, so tests pass stubs for the verifier and the database. Imported by `server.mjs` and tests.
- `package.json` — Name, version, `type: module`, `engines`, and `start` and `test` scripts. One dependency, `@neondatabase/serverless`, loaded only when `DATABASE_URL` is set.
- `public/index.html` — Single-page app with 3 views: setup, chat, debrief. Loads the PostHog snippet (section 9).
- `public/styles.css` — CSS variables, no frameworks. Warm neutral palette (navy + cream), no AI design clichés.
- `public/app.js` — Browser logic: Google sign-in (button from Google Identity Services, token in memory and in `sessionStorage` under `ra_id_token`, `authFetch` adds the Bearer header and on a 401 shows the sign-in screen over the page), setup, turn flow, calls to `/api/chat` (or mock replies), debrief rendering, analytics events. Mock mode and the GitHub Pages demo skip sign-in. When signed in, the first name (`given_name`, cleaned to letters, spaces, hyphens and apostrophes, 30 characters) is the facilitator's name in resident prompts and chat labels; otherwise it is "RA". It is never sent to PostHog, and the saved record scrubs it back to "RA".
- `public/logic.js` — Pure, testable logic (ES module): responder routing, request body, reply cleanup, resident openness and tagger parsing, mediation prompt, agreement check, mock-mode flags.
- `public/config.js` — No-DOM settings and builders: every model id (`RESIDENT_MODEL`, `GRADER_MODELS`, `TAGGER_MODEL`, `ROUTER_MODEL`, each read from the environment with a default; `allModelIds()` feeds the server allowlist), `REASONING` (one reasoning setting, off, used by `RESIDENT_OPTS`, `ROUTER_OPTS`, `TAGGER_OPTS` and `GRADER_OPTS`; a model that cannot turn it off uses `REASONING_LOWEST` through `graderOpts`), token and option constants, `MAX_TURNS` (15), `getProfiles`, Alex and Jordan intro prompts, `createSession()`. Imported by `app.js`, `mock.js`, tests and `tools/`.
- `public/rubric.js` — The 15-question rubric and pure functions: grader prompt, reply parsing, quote check, voting, score, coaching tip. See section 8.
- `tts.mjs` — TTS providers (`TTS_PROVIDER`) and STT providers (`STT_PROVIDER`), `stub` only for now, plus the list of retired voice models. Imported by `server.mjs` and tests.
- `public/voice.js` — Practice mode storage, text cap for read-aloud, reveal pacing and `createLiveLine`, the message element whose text can grow while audio plays. Imported by `app.js` and tests.
- `public/liveRecord.js` — Pure: builds the record `app.js` sends at the end of a live session, replaces the RA name with "RA", and counts token usage per role.
- `public/mock.js` — Canned replies for `?mock=1`. It reads the difficulty from the real mood text in `config.js`. Prompt detection still uses short phrases from the real prompts, and `tests/mock.test.mjs` builds the real intro, mediation and rubric prompts and fails if the mock stops recognising them.
- `tests/` — 30 `node:test` files, run with `node --test tests/*.test.mjs`, plus `tests/README.md` (Build 4 evaluation tracks).
- `docs/model-choice.md` — chosen models, prices, zero retention results, decision rule and open questions for NYU.
- `tools/` — `zdrcheck.mjs` (zero retention check per model), `pull-posthog.mjs` (aggregate analytics to `docs/analytics.json`), `export-live.mjs` (redacted copies of live sessions), `simulate.mjs` (simulated sessions), `probe-models.mjs` (grader probe), `report.mjs` (summary of saved runs), `personas.mjs` (10 simulated RA personas, data only), `prices.json` (USD per million tokens; every entry is still `null`).
- `transcripts/` — Output of `tools/simulate.mjs`: `YYYY-MM-DD/HHMMSS-<scenario>-<difficulty>-<persona>.json`, plus `index.csv`. Read by `tools/report.mjs`.
- `transcripts/live/` — Live sessions saved by the server (git-ignored): `YYYY-MM-DD/HHMMSS-<topic>-<difficulty>.json` plus `index.csv`. `tools/report.mjs` skips them (`source: "live"`).
- `transcripts/shared/` — Redacted copies made by `tools/export-live.mjs`. The only transcripts that may be committed.
- `scripts/sync-demo.sh` — Rebuilds `docs/demo/` from `public/`.
- `scripts/smoke.mjs` — `node scripts/smoke.mjs <base URL> [--commit <sha>]`. Post-deploy checks, see Shipping.
- `.env.example` — Placeholder only. Copy it to `.env`. `.env` is git-ignored and must never be committed.
- `.env` — `OPENROUTER_API_KEY=sk-or-v1-...` (NEVER commit)
- `docs/index.html` — Product Page / Living PRD (GitHub Pages from `/docs`). `docs/demo/` is the generated copy of the app for the hosted mock demo.
- `FIXES.md` — Notes from the nine-commit fix plan. `Plan.md`, `Intent.md`, `SPONSOR_MEMO.md` and `journal/` are course drafting docs.

## 4. API Key Security
- The key lives ONLY in `.env` on the builder's machine.
- The browser sends requests to `localhost:3000/api/chat`; the server adds the `Authorization` header.
- `.env` is in `.gitignore` and must never be staged.
- If the app is ever hosted publicly, the key MUST stay behind a server proxy; never ship it to the client.

## 5. Models Used
| Role | Model | Used for | Defined in |
|------|-------|----------|------------|
| Resident replies (Alex, Jordan, mediation) | `anthropic/claude-haiku-5.5` | every resident message, reasoning off | `RESIDENT_MODEL` in `public/config.js` (env `RESIDENT_MODEL`) |
| Grader 1 "Claude" | `anthropic/claude-haiku-5.5` | debrief | `GRADER_MODELS[0]` (env `GRADER_1_MODEL`) |
| Grader 2 "Gemini" | `google/gemini-3.1-flash-lite` | debrief, reasoning off. Replaced `google/gemini-3.6-flash` on 2026-11-23: that model cannot turn reasoning off and failed to finish grading in 90 of 118 sessions (see `docs/model-choice.md`) | `GRADER_MODELS[1]` (env `GRADER_2_MODEL`) |
| Grader 3 "GPT" | `openai/gpt-6-luna` | debrief | `GRADER_MODELS[2]` (env `GRADER_3_MODEL`) |
| Tagger (labels each RA message) | `anthropic/claude-haiku-5.5` | resident openness, every RA turn | `TAGGER_MODEL` (env `TAGGER_MODEL`) |
| Router (picks who answers when nobody is named) | `anthropic/claude-haiku-5.5` | unclear RA messages | `ROUTER_MODEL` (env `ROUTER_MODEL`) |
| Simulated RA (tools only) | `deepseek/deepseek-chat` by default | `tools/simulate.mjs` | `--ra-model` default in `parseArgs` |

Browser calls go through the local server. `tools/` calls OpenRouter directly.

All model ids live in `public/config.js`, each overridable by an environment variable (table above). The server builds `ALLOWED_MODELS` from them (`allModelIds()`) and tells the browser the ids in `/config.json`, so one change is enough. Every model must have a zero data retention route: run `node tools/zdrcheck.mjs`. If OpenRouter answers "No endpoints found", the call fails with a clear message naming the model and is logged (`[zdr]`); it is never retried on another model. `tools/probe-models.mjs` keeps its own copy of the grader ids, so update it by hand.

## 6. Non-Negotiable Engineering Rules
1. **Plan before coding:** Before touching multiple files, propose a brief plan and wait for approval.
2. **Small batches:** Make small, focused changes that can be reviewed and explained by a human in a single Pull Request.
3. **Explainability:** Avoid unnecessary abstractions or dependencies. Help the human builder understand the main components, what changed, why it matters, what could break, and how it was checked.
4. **Verify changes:** Run relevant checks. For a reproducible logic bug, use a failing test to demonstrate the fix when practical. Record manual checks and known limitations; follow the selected Build 4 evaluation track.
5. **Zero secrets in code:** Never hardcode API keys, tokens, or credentials. Always read from environment variables (`.env`) and update `.env.example` when new variables are needed.
6. **Stop when looping:** If a fix fails twice in a row, stop, summarize what failed, and ask the human before trying a third approach.
7. **Anti-slop frontend:** No fade-up animations, no teal/cyan accents, no generic card grids, no em dashes in user-visible copy, no fake data names. Follow installed Pi skills (frontend-design, frontend-create, anti-slop-frontend).

## 7. Spec Kit Workflow
This project uses GitHub Spec Kit for structured development:
```bash
export PATH="$HOME/.local/bin:$PATH"
specify --version  # 1.2.5
```
Artifacts live in `.specify/features/roommate-conflict-v1/`:
- `spec.md` — functional requirements and success criteria
- `plan.md` — architecture, data model, phases
- `tasks.md` — checklisted work items + convergence findings
- `.specify/memory/constitution.md` — project principles (security, local-first, anti-slop)

## 8. Rubric Scoring
The debrief scores the RA with a 15-question yes/no rubric in `public/rubric.js` (`RUBRIC_VERSION` 4). Questions are grouped as Setting the stage, Hearing both sides, Staying neutral, Facilitating, Compromise and Closing.

1. Each of the three grader models gets the same prompt and answers all 15 questions. Graders judge only the RA's lines.
2. A YES must include a quote of up to 12 words copied from an RA line. Code checks the quote, ignoring case, extra spaces and curly quotes. If the quote is not found, the YES becomes NO.
3. A grader's reply is usable if at least 10 of the 15 lines parse. Missing lines count as NO.
4. Each question is met by vote. With 3 usable graders, 2 YES votes are needed. With 2, both must say YES. With 1, that grader decides. With none, nothing is met.
5. Score = questions met out of 15, as a percentage, computed in code. The debrief shows "X of 15", the grader agreement for each question, and one tip for the first missed question. The two reflection questions are shown but not scored.

### Rubric versions
- Version 1: first rubric.
- Version 2: the grader prompt requires a quote for the "avoid" questions (Q8, Q9, Q11).
- Version 3: the three graders changed to Claude Haiku 5.5, Gemini and GPT-6 Luna.
- Version 4: the parser drops a leading `RA:` label from a quote (Claude copied it, so correct quotes failed the evidence check and its score collapsed; agreement with GPT 71% before, 83% after), and Grader 2 is Gemini 3.1 Flash Lite. `verifyEvidence` is unchanged. Scores from version 4 are not comparable with earlier versions. Stored sessions keep the `rubricVersion` they were saved with.
- Persona ranges: `average` retuned to 3 to 7 for the new graders; the others held. Grader disagreement was 17.8% (80 of 450 questions) against 20.6% before.

### Grader token budget
`TOKENS_GRADER` (public/config.js) is 2000 (was 1500): a current grader was cut off once in 187 calls, which the rule in `docs/model-choice.md` treats as a reason to raise it. `node tools/report.mjs` section (j) shows output tokens per grader call (median, p95, max, cut off); new sessions save the real `completionTokens`.

### Plan rate bar (how to judge "a plan can be reached")
`node tools/report.mjs --dir <folder>` prints section (i). The bar for the strong-style personas (`strong`, `typo-good`, `nickname-both`, marked `expectsPlan` in `tools/personas.mjs`) is:
- at least 75 percent of all their sessions reach a plan, and
- no persona-and-difficulty cell is flagged. A cell is flagged only when it is under 50 percent over 8 or more sessions (several cycles), so a small cell cannot fail by bad luck.
- Every other persona (hostile, side-taker, solution-pusher, minimal, injection, average, rushed-good) must never reach a plan. Any plan there is reported as a problem.

Why not "every cell at least 2 of 3 in one cycle": with 9 cells and 3 runs each, even a system that resolves 76 percent of sessions passes that only about 19 percent of the time (measured: 1 pass in 4 cycles). It measured luck.

### Future improvements
- **Option A: the tagger checks plans against the must-haves.** Most unresolved strong sessions end with a plan that leaves out a limit a resident stated (for example the 11:30 end time for the study group) or changes one. Give the tagger each resident's must-haves as a written checklist, have it say which must-have a proposed plan misses, and let the RA see that. This attacks the cause of the remaining failures rather than how we count them.
- **Option B: a stronger simulated RA** for plan-writing, since the weakest cells fail because the simulated RA's plan is incomplete.

## 9. Analytics (PostHog)
- The PostHog snippet in `public/index.html` (and its copy in `docs/demo/`) uses the project key `phc_...`. This is a public, client-side key, so it is allowed in code.
- Personal API keys (`phx_...`) and any other PostHog personal or secret key must never be committed or pasted into any file, and the app never uses one. The one exception is `tools/pull-posthog.mjs`, which reads `POSTHOG_PERSONAL_API_KEY` and `POSTHOG_PROJECT_ID` from the git-ignored `.env` (`.env.example` has them empty).
- `node tools/pull-posthog.mjs [--days 120] [--out docs/analytics.json]` queries PostHog (HogQL, `POST https://us.posthog.com/api/projects/<id>/query/`) for `app_mode` live and demo separately, and writes aggregates only (sessions, users, debriefs, completion rate, median turns, average rubric met, generated date) to `docs/analytics.json`. `docs/index.html` loads that file into the User Evidence box and shows "Not yet measured" if it is missing. Live numbers come from `session_started`, `session_ended` and `debrief_viewed` events; the key needs the `query:read` scope.
- Events carry counts and labels only (turn number, character count, topic, difficulty, met count, error location). They never carry message text, the RA's name or transcripts.
- Analytics never throws. A blocked PostHog does not break the app.

## 10. Live Session Saving
Every session on the local server (not `?mock=1`, not GitHub Pages) is saved to disk for later review.

1. **When:** `app.js` posts the record to `POST /api/transcript` when the debrief finishes. If the tab is closed first, a `pagehide` handler sends a partial record (`partial: true`, no grader results) with `navigator.sendBeacon`. Both need at least 2 RA turns, and a session is sent once. A failed save is logged to the console and never shown or thrown, in the same style as `track()`.
2. **Route rules:** same Origin and Host checks as `/api/chat`, POST only, login required (section 2, Server-side auth), body capped at 200 KB, any body containing `sk-or-` (or the loaded key) is refused with 400, only known fields are kept. The server adds `source: "live"` and the git commit; the browser cannot set either.
3. **Record:** the simulator shape plus `source`: `scenario` (the topic), `difficulty`, `transcript` lines with `turn`, `role` (`ra` or `resident`), `sender` and `text`, `openness` start and per turn, `routing` per turn (who answered and whether code or the router decided), `graders` with answers, `combined`, `result`, `models`, `usage` (calls and tokens per role: resident, tagger, router, graders) and `gitCommit`. Cost is not stored.
4. **Privacy:** the RA name is replaced by "RA" in the browser before sending, including inside message text. It is skipped if the name is "You" (no name entered), Alex or Jordan. Messages can still contain other personal details, so `transcripts/live/` is git-ignored and sharing goes through `tools/export-live.mjs`.
5. **PostHog is unchanged:** it still gets counts and labels only. Saved transcripts never go to PostHog.

## 11. Known Gaps
1. **Voice is only built with stub providers.** Read-aloud and push-to-talk work end to end with `TTS_PROVIDER=stub` and `STT_PROVIDER=stub` (silent audio, canned text). No real vendor is chosen or tested, push-to-talk does not show words while speaking (the stub does not stream), and neither has a browser test. See `docs/model-choice.md` for the open questions.
2. **No retry.** Failed grader calls are shown as failed, and failed resident calls show an error for the RA to retry. Nothing retries with backoff (T046).
3. **No cost in the UI.** The debrief does not show per-session cost (T045). Cost is only reported by `tools/simulate.mjs` and `tools/report.mjs`.
4. **Keyboard:** Enter sends. There is no Escape shortcut to end a session (T048). The debrief has no loading spinner (T047).
5. **`probe-models.mjs` tests an old prompt.** It copies a grader prompt with a `SCORE` and `STRENGTHS` format from an earlier version. The app now uses `buildRubricPrompt` in `public/rubric.js`, and there is no `graderPrompt()` in `app.js`. Probe results do not describe the current graders.
6. **`--max-turns` has no effect.** Each built-in persona sets its own `maxTurns`, and that value wins. The flag only applies to a persona without one, and all ten have one.
7. **Stale comments.** `server.mjs` says its model list is kept in sync with `public/app.js` and mentions `CONSOLIDATOR_MODEL`. Neither exists now: the lists are in `public/config.js`, and the debrief has no consolidator. `FIXES.md` has the same history.
8. **Cost limits depend on OpenRouter.** `--max-cost` counts the cost the API reports as `usage.cost`; `tools/prices.json` (USD per million tokens, copied from OpenRouter on 2026-11-23) is only a fallback when a response has no cost. Unknown costs are shown as unknown and are not counted. `DAILY_CALL_CAP` counts calls, not dollars. At the measured Haiku 5.5 cost of about $0.00025 per call (about $0.005 per session), 500 calls a day is about $0.13.
9. **Tests do not cover live model behaviour or the browser UI.** There is no browser test. Model quality is checked by hand and by `tools/simulate.mjs`. `tests/config.test.mjs` does not check `TAGGER_MODEL` against the allowlist.
10. **Residents and plans.** `RESIDENT-NOTES.md` (not yet committed) found that residents reached agreement whatever the RA did, so agreement is not a sign of good mediation. The guards are in `resolutionState`: a plan needs `proposal_on_table`, `plan_has_specifics`, the tagger's `meets_needs` for each resident, openness of at least 1 (`OPEN_ENOUGH`, was 2), and an explicit confirmation from each. Rules as of 2026-11-23: `MAX_TURNS` is 15. A `proposes_solution` message lowers a resident's openness only if the resident is at 0 and the message does not invite input. A confirmation is judged on its statements only (a question after "That works for me." does not void it) and also accepts "I can live with that", "I'm fine with the plan" and similar. An acceptance stands until the resident takes it back (a hedge or a question, or a reply to a message that restates the plan with specifics when the tagger says it breaks their must-haves); a neutral reply or a vague wrap-up does not void it. The resident prompt tells a resident to accept a plan that keeps their must-haves ("That works for me." plus what and when). `tools/simulate.mjs` routes like the app. Results over 108 simulated sessions (strong, typo-good, nickname-both at easy, medium and hard, 4 cycles): 82 resolved (76%), weakest cell 7 of 12 (58%). That passes the plan rate bar (at least 75% overall, no cell under 50% over 8 or more sessions; see "Plan rate bar"). The old bar (every cell at least 2 of 3 in one cycle) passed once in four cycles and was replaced. Hostile, side-taking, solution-pushing and minimal RAs resolved 0 of 24 at every difficulty. What still fails: 12 sessions end with the plan missing or changing something a resident said they cannot give up (such as the 11:30 end time), and 12 with a resident hedging or asking at the end. Some resolved plans may still break a must-have the tagger missed (seen once in a medium run); this is not measured. Option A (the tagger checks plans against must-haves) is the next improvement.
11. **Same model plays and grades.** `anthropic/claude-haiku-5.5` is the resident model, the tagger, the router and Grader 1, which may bias that grader. This is not measured.
12. **Saved data is not managed.** Live sessions pile up in `transcripts/live/` with no cleanup, and a partial save from a closed tab is not merged with a later full one. The browser keeps the last 20 sessions in `localStorage` under `ra_logs`, with no UI to view or delete them. `transcripts/` (except `live/`, which is git-ignored) is not committed and not in `.gitignore`.
13. **Mostly local.** Locally the server binds to `127.0.0.1` with a single key from `.env`. The GitHub Pages demo is mock mode only, with no API calls. Hosting the live app would need a server-side proxy, as section 4 says.

## Shipping
Hosting is Render. CI is `.github/workflows/ci.yml`; its one job is named `test` (checkout, `npm ci`, `node --check server.mjs`, `npm test`, `npm audit --audit-level=high`, secret scan).

### Flow for every change
1. **Branch:** `git switch -c <name>` from an up to date `main`. Never commit to `main`.
2. **Commit:** small commits. Run `npm test` first. Never stage `.env`.
3. **Pull request:** `git push -u origin <name>`, then `gh pr create`. Do not push to `main`.
4. **CI:** the check named `test` must pass. Watch it with `gh pr checks --watch`.
5. **Render preview:** Pull Request Previews are Automatic, so Render builds a preview URL for the PR. Open it and run `node scripts/smoke.mjs <preview URL>`. A preview is safe by design: Render sets `IS_PULL_REQUEST=true`, and the server then forces live AI off (`/api/chat` returns 503) and refuses `/api/transcript` (nothing is written), whatever the other variables say. Test the real AI only on the production service.
6. **Merge:** a human merges the PR on GitHub after `test` is green. Agents do not merge.
7. **Deploy:** with Auto-Deploy set to After CI Checks Pass, Render deploys `main` only once `test` passes on that commit. A red check means no deploy.
8. **Verify the live site:** `node scripts/smoke.mjs https://<service>.onrender.com --commit $(git rev-parse HEAD)`. It checks `/healthz` (200, and the commit matches), that `/` serves the page, that `/api/chat` without a valid Origin is refused, that a bad Origin gets 403, and the three security headers. Then open the site and run one real session. The free instance sleeps when idle, so the first request can take up to a minute.
9. **Roll back:** see below.

### Render settings
| Setting | Value |
|---|---|
| Service type | Web Service, from this GitHub repo, branch `main` |
| Runtime | Node |
| Build command | `npm ci` |
| Start command | `npm start` |
| Instance type | Free |
| Health check path | `/healthz` |
| Auto-Deploy | After CI Checks Pass |
| Pull Request Previews | Automatic |

### Environment variables on Render
Set these in the service's Environment tab. Never commit values.

| Variable | Value | What it is for |
|---|---|---|
| `NODE_ENV` | `production` | Binds `0.0.0.0` (Render needs this) and trusts the first `x-forwarded-for` entry as the client IP. |
| `OPENROUTER_API_KEY` | your key, secret | Required. The server exits without it. Used only server side. |
| `LIVE_AI_ENABLED` | `true` on production | Turns on `/api/chat`. Off by default. Ignored in previews. |
| `PUBLIC_ORIGIN` | the live URL, set after the first deploy | Extra origin and host the server accepts. Without it the live site rejects its own browser requests with 403. |
| `RATE_LIMIT_MAX` | `60` (default) | Requests per client IP per window on `/api/chat` and `/api/transcript`. |
| `RATE_LIMIT_WINDOW_MINUTES` | `10` (default) | Length of that window. |
| `DAILY_CALL_CAP` | `500` (default) | Global `/api/chat` calls per UTC day, then 503. This is the spending guard. Raising it needs approval. |
| `GOOGLE_CLIENT_ID` | the OAuth client id | Required for sign-in. Add the live URL to the client's authorized JavaScript origins in Google Cloud. |
| `ALLOWED_GOOGLE_DOMAIN` | optional | Limits sign-in to one Google Workspace domain. |
| `USER_CALLS_PER_HOUR`, `USER_SESSIONS_PER_DAY` | `150`, `10` (defaults) | Per user limits. Raising them needs approval. |
| `DATABASE_URL` | Neon connection string, secret | Optional. Without it sessions go to files on the instance's disk. Set by the human only. |
| `PORT` | set by Render | Listen port. Do not set it yourself. |
| `RENDER_GIT_COMMIT` | set by Render | Full SHA of the deployed commit. Shown by `/healthz` as `commit`. |
| `IS_PULL_REQUEST` | set by Render | The string `true` on pull request previews, `false` otherwise. Triggers preview safety. |

`POSTHOG_PERSONAL_API_KEY` and `POSTHOG_PROJECT_ID` are only for `tools/pull-posthog.mjs` on the builder's machine. Do not set them on Render.

Transcripts are written to the instance's disk, which is wiped on every deploy and restart on the free plan. Treat saved live sessions on Render as temporary.

### Setting PUBLIC_ORIGIN after the first deploy
1. Create the service with every variable above except `PUBLIC_ORIGIN`. Wait for the first deploy to go live.
2. Copy the URL Render shows, for example `https://<service>.onrender.com` (scheme and host only, no trailing slash or path).
3. Add `PUBLIC_ORIGIN` with that value in the Environment tab and save. Render redeploys.
4. Run `node scripts/smoke.mjs <that URL>` and open the site. If you later add a custom domain, set `PUBLIC_ORIGIN` to both, separated by a comma.

### Roll back
1. In the Render dashboard open the service, then Events (or Deploys), and find the last good deploy.
2. Click Rollback on that deploy and confirm. Render redeploys that build without a new CI run. Check that `/healthz` shows the old commit.
3. Auto-Deploy is turned off by a rollback, so a later merge will not deploy by surprise. Fix forward on a new branch, or revert on `main` with a pull request (`git revert <sha>`, never a force push), then turn Auto-Deploy back on.
4. If the cause is a bad environment variable, fix it in the Environment tab instead. If spend is the problem, set `LIVE_AI_ENABLED=false` first: it stops all AI calls at once.
5. Run `node scripts/smoke.mjs <URL> --commit <good sha>` to confirm.

## Ask me first
Stop and ask me before doing any of these:
- Deleting or changing data in the database.
- Changing the database schema or Row Level Security policies.
- Creating or editing keys, secrets, env vars or permissions.
- Adding a paid service, or raising any spending or token limit.
- Force-pushing or rewriting git history.
- Deleting files outside the current task.
- Installing new dependencies.
- Running `scripts/migrate.mjs` against production.

## Database migrations
- Schema changes are made only through new numbered migration files in `migrations/`, and never by editing an applied one.
- Running `scripts/migrate.mjs` against the dev database is allowed only when I have asked for that change.
- Running it against production is on the Ask me first list, and only the human runs it.
- The agent must never ask for, store or paste the production connection string.
- See `migrations/README.md` for the commands.

## Rules from real mistakes
- **(a)** Never report a vulnerability or bug without reproducing it with a command and showing the output. An agent once reported a path traversal that did not reproduce.
- **(b)** Do not create new config files or revert my model choices unless I ask. An agent once planned to create a repo-level `models.json` and revert the grader models.
- **(c)** Read the real config location before answering where config lives. An agent once answered with the app's config instead of the Pi config.

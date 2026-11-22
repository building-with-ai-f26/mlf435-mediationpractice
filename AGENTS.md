# AGENTS.md — Coding Agent Operating Manual

> Give this file to your coding agent and check that it is using these instructions. Keep the stack, commands, and ground rules current.

## 1. Project Overview
- **What this repo builds:** A local web application that lets Resident Assistants practice mediating roommate conflicts with AI residents. The RA picks a topic and difficulty, mediates between two AI roommates via text (voice in v2), and receives a graded debrief from 3 AI models.
- **Primary user & core workflow:** A current RA on the builder's Housing Team. Workflow: setup (name, topic, difficulty) → context cards → Alex introduces → Jordan introduces → RA mediates (turn-based) → end session → 3 AI graders answer a 15-question yes/no rubric; code verifies quotes, votes and scores.
- **Tech stack:** Node.js 20+ (built-in `http` module) / Vanilla HTML+CSS+JS / OpenRouter API (DeepSeek, Claude Haiku, Gemini Flash)

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
- **Run tests:** `node --test tests/*.test.mjs` (or `npm test`). Deterministic and offline: 195 tests in 20 files. The live-transcript test starts `server.mjs` on a random local port in a temporary folder.
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

`GET /healthz` returns `200 {"ok":true}` and nothing else. Every response carries `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` and `Referrer-Policy: strict-origin-when-cross-origin`. There is no Content-Security-Policy yet because the PostHog snippet is inline.

## 3. Architecture
- `server.mjs` — Node `http` server on `127.0.0.1`. Serves `public/` (GET and HEAD only) and forwards `POST /api/chat` to OpenRouter, adding the key from `.env`. Rejects models not in `ALLOWED_MODELS`, bodies over 64 KB, and requests with an unexpected Origin or Host.
- `chatBody.mjs` — Validates the `/api/chat` body: model allowlist, non-empty messages, `max_tokens` (capped at 2000), temperature clamp, `reasoning` shape. Imported by `server.mjs`.
- `liveTranscript.mjs` — Validates and saves one live session for `POST /api/transcript`: 200 KB cap, refuses `sk-or-` and the loaded key, keeps only known fields, adds `source: "live"` and the git commit, writes the file and the index row. Imported by `server.mjs` and tests.
- `origins.mjs` — The allowed origins and hosts: `localhost` and `127.0.0.1` on the server port, plus `PUBLIC_ORIGIN`. Imported by `server.mjs`.
- `limits.mjs` — In-memory per-IP rate limiter, daily call cap and env parsing helpers. Imported by `server.mjs` and tests.
- `package.json` — Name, version, `type: module`, `engines`, and `start` and `test` scripts. No dependencies.
- `public/index.html` — Single-page app with 3 views: setup, chat, debrief. Loads the PostHog snippet (section 9).
- `public/styles.css` — CSS variables, no frameworks. Warm neutral palette (navy + cream), no AI design clichés.
- `public/app.js` — Browser logic: setup, turn flow, calls to `/api/chat` (or mock replies), debrief rendering, analytics events.
- `public/logic.js` — Pure, testable logic (ES module): responder routing, request body, reply cleanup, resident openness and tagger parsing, mediation prompt, agreement check, mock-mode flags.
- `public/config.js` — No-DOM settings and builders: model ids (`MAIN_MODEL`, `GRADER_MODELS`, `TAGGER_MODEL`), token and option constants, `MAX_TURNS` (10), `getProfiles`, Alex and Jordan intro prompts, `createSession()`. Imported by `app.js`, `mock.js`, tests and `tools/`.
- `public/rubric.js` — The 15-question rubric and pure functions: grader prompt, reply parsing, quote check, voting, score, coaching tip. See section 8.
- `public/liveRecord.js` — Pure: builds the record `app.js` sends at the end of a live session, replaces the RA name with "RA", and counts token usage per role.
- `public/mock.js` — Canned replies for `?mock=1`. It reads the difficulty from the real mood text in `config.js`. Prompt detection still uses short phrases from the real prompts, and `tests/mock.test.mjs` builds the real intro, mediation and rubric prompts and fails if the mock stops recognising them.
- `tests/` — 20 `node:test` files, run with `node --test tests/*.test.mjs`, plus `tests/README.md` (Build 4 evaluation tracks).
- `tools/` — `pull-posthog.mjs` (aggregate analytics to `docs/analytics.json`), `export-live.mjs` (redacted copies of live sessions), `simulate.mjs` (simulated sessions), `probe-models.mjs` (grader probe), `report.mjs` (summary of saved runs), `personas.mjs` (10 simulated RA personas, data only), `prices.json` (USD per million tokens; every entry is still `null`).
- `transcripts/` — Output of `tools/simulate.mjs`: `YYYY-MM-DD/HHMMSS-<scenario>-<difficulty>-<persona>.json`, plus `index.csv`. Read by `tools/report.mjs`.
- `transcripts/live/` — Live sessions saved by the server (git-ignored): `YYYY-MM-DD/HHMMSS-<topic>-<difficulty>.json` plus `index.csv`. `tools/report.mjs` skips them (`source: "live"`).
- `transcripts/shared/` — Redacted copies made by `tools/export-live.mjs`. The only transcripts that may be committed.
- `scripts/sync-demo.sh` — Rebuilds `docs/demo/` from `public/`.
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
| Resident replies (Alex, Jordan, mediation) | `deepseek/deepseek-chat` | every resident message | `MAIN_MODEL` in `public/config.js` |
| Grader 1 "DeepSeek" | `deepseek/deepseek-chat` | debrief | `GRADER_MODELS` in `public/config.js` |
| Grader 2 "Claude" | `anthropic/claude-haiku-5.5` | debrief | `GRADER_MODELS` in `public/config.js` |
| Grader 3 "Gemini" | `google/gemini-2.5-flash` | debrief | `GRADER_MODELS` in `public/config.js` |
| Tagger (labels each RA message) | `anthropic/claude-haiku-5.5` | resident openness, every RA turn | `TAGGER_MODEL` in `public/config.js` |
| Simulated RA (tools only) | `deepseek/deepseek-chat` by default | `tools/simulate.mjs` | `--ra-model` default in `parseArgs` |

Browser calls go through the local server. `tools/` calls OpenRouter directly.

Model IDs must match in three places: `MAIN_MODEL`, `GRADER_MODELS` and `TAGGER_MODEL` in `public/config.js`, and `ALLOWED_MODELS` in `server.mjs`. The server rejects any model not on its allowlist, so update all of them together. `tests/config.test.mjs` checks that `MAIN_MODEL` and the grader ids are on the allowlist. It does not check `TAGGER_MODEL`. `tools/probe-models.mjs` keeps its own copy of the grader ids, so update it by hand too.

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
The debrief scores the RA with a 15-question yes/no rubric in `public/rubric.js` (`RUBRIC_VERSION` 1). Questions are grouped as Setting the stage, Hearing both sides, Staying neutral, Facilitating, Compromise and Closing.

1. Each of the three grader models gets the same prompt and answers all 15 questions. Graders judge only the RA's lines.
2. A YES must include a quote of up to 12 words copied from an RA line. Code checks the quote, ignoring case, extra spaces and curly quotes. If the quote is not found, the YES becomes NO.
3. A grader's reply is usable if at least 10 of the 15 lines parse. Missing lines count as NO.
4. Each question is met by vote. With 3 usable graders, 2 YES votes are needed. With 2, both must say YES. With 1, that grader decides. With none, nothing is met.
5. Score = questions met out of 15, as a percentage, computed in code. The debrief shows "X of 15", the grader agreement for each question, and one tip for the first missed question. The two reflection questions are shown but not scored.

## 9. Analytics (PostHog)
- The PostHog snippet in `public/index.html` (and its copy in `docs/demo/`) uses the project key `phc_...`. This is a public, client-side key, so it is allowed in code.
- Personal API keys (`phx_...`) and any other PostHog personal or secret key must never be committed or pasted into any file, and the app never uses one. The one exception is `tools/pull-posthog.mjs`, which reads `POSTHOG_PERSONAL_API_KEY` and `POSTHOG_PROJECT_ID` from the git-ignored `.env` (`.env.example` has them empty).
- `node tools/pull-posthog.mjs [--days 120] [--out docs/analytics.json]` queries PostHog (HogQL, `POST https://us.posthog.com/api/projects/<id>/query/`) for `app_mode` live and demo separately, and writes aggregates only (sessions, users, debriefs, completion rate, median turns, average rubric met, generated date) to `docs/analytics.json`. `docs/index.html` loads that file into the User Evidence box and shows "Not yet measured" if it is missing. Live numbers come from `session_started`, `session_ended` and `debrief_viewed` events; the key needs the `query:read` scope.
- Events carry counts and labels only (turn number, character count, topic, difficulty, met count, error location). They never carry message text, the RA's name or transcripts.
- Analytics never throws. A blocked PostHog does not break the app.

## 10. Live Session Saving
Every session on the local server (not `?mock=1`, not GitHub Pages) is saved to disk for later review.

1. **When:** `app.js` posts the record to `POST /api/transcript` when the debrief finishes. If the tab is closed first, a `pagehide` handler sends a partial record (`partial: true`, no grader results) with `navigator.sendBeacon`. Both need at least 2 RA turns, and a session is sent once. A failed save is logged to the console and never shown or thrown, in the same style as `track()`.
2. **Route rules:** same Origin and Host checks as `/api/chat`, POST only, body capped at 200 KB, any body containing `sk-or-` (or the loaded key) is refused with 400, only known fields are kept. The server adds `source: "live"` and the git commit; the browser cannot set either.
3. **Record:** the simulator shape plus `source`: `scenario` (the topic), `difficulty`, `transcript` lines with `turn`, `role` (`ra` or `resident`), `sender` and `text`, `openness` start and per turn, `routing` per turn (who answered and whether code or the router decided), `graders` with answers, `combined`, `result`, `models`, `usage` (calls and tokens per role: resident, tagger, router, graders) and `gitCommit`. Cost is not stored.
4. **Privacy:** the RA name is replaced by "RA" in the browser before sending, including inside message text. It is skipped if the name is "You" (no name entered), Alex or Jordan. Messages can still contain other personal details, so `transcripts/live/` is git-ignored and sharing goes through `tools/export-live.mjs`.
5. **PostHog is unchanged:** it still gets counts and labels only. Saved transcripts never go to PostHog.

## 11. Known Gaps
1. **Voice input is not built.** Planned for v2 (spec task T042).
2. **No retry.** Failed grader calls are shown as failed, and failed resident calls show an error for the RA to retry. Nothing retries with backoff (T046).
3. **No cost in the UI.** The debrief does not show per-session cost (T045). Cost is only reported by `tools/simulate.mjs` and `tools/report.mjs`.
4. **Keyboard:** Enter sends. There is no Escape shortcut to end a session (T048). The debrief has no loading spinner (T047).
5. **`probe-models.mjs` tests an old prompt.** It copies a grader prompt with a `SCORE` and `STRENGTHS` format from an earlier version. The app now uses `buildRubricPrompt` in `public/rubric.js`, and there is no `graderPrompt()` in `app.js`. Probe results do not describe the current graders.
6. **`--max-turns` has no effect.** Each built-in persona sets its own `maxTurns`, and that value wins. The flag only applies to a persona without one, and all ten have one.
7. **Stale comments.** `server.mjs` says its model list is kept in sync with `public/app.js` and mentions `CONSOLIDATOR_MODEL`. Neither exists now: the lists are in `public/config.js`, and the debrief has no consolidator. `FIXES.md` has the same history.
8. **Cost limits depend on OpenRouter.** Every price in `tools/prices.json` is `null`. `--max-cost` counts only costs that the API reports as `usage.cost`. Unknown costs are shown as unknown and are not counted.
9. **Tests do not cover live model behaviour or the browser UI.** There is no browser test. Model quality is checked by hand and by `tools/simulate.mjs`. `tests/config.test.mjs` does not check `TAGGER_MODEL` against the allowlist.
10. **Residents agree too easily.** `RESIDENT-NOTES.md` (not yet committed) finds that residents reach agreement whatever the RA does, so the agreement is not a reliable sign of good mediation.
11. **Same model plays and grades.** `deepseek/deepseek-chat` is both the resident model and Grader 1, which may bias that grader. This is not measured.
12. **Saved data is not managed.** Live sessions pile up in `transcripts/live/` with no cleanup, and a partial save from a closed tab is not merged with a later full one. The browser keeps the last 20 sessions in `localStorage` under `ra_logs`, with no UI to view or delete them. `transcripts/` (except `live/`, which is git-ignored) is not committed and not in `.gitignore`.
13. **Local only.** The server binds to `127.0.0.1` with a single key from `.env`. The GitHub Pages demo is mock mode only, with no API calls. Hosting the live app would need a server-side proxy, as section 4 says.

## Shipping
Filled in after the first deploy (step B3-3)

## Ask me first
Stop and ask me before doing any of these:
- Deleting or changing data in the database.
- Changing the database schema or Row Level Security policies.
- Creating or editing keys, secrets, env vars or permissions.
- Adding a paid service, or raising any spending or token limit.
- Force-pushing or rewriting git history.
- Deleting files outside the current task.
- Installing new dependencies.

## Rules from real mistakes
- **(a)** Never report a vulnerability or bug without reproducing it with a command and showing the output. An agent once reported a path traversal that did not reproduce.
- **(b)** Do not create new config files or revert my model choices unless I ask. An agent once planned to create a repo-level `models.json` and revert the grader models.
- **(c)** Read the real config location before answering where config lives. An agent once answered with the app's config instead of the Pi config.

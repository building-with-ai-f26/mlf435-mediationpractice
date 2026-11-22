# Security

This file records the security checks run on RA Practice Scenarios, what they found, what was fixed, and what is still open.

## 1. App type

An AI app with Google sign-in and a database:

- **AI:** `/api/chat` forwards requests to OpenRouter (DeepSeek, Claude Haiku, Gemini Flash). The OpenRouter key stays on the server.
- **Sign-in:** Google ID tokens are verified on the server by `auth.mjs` (RS256 signature, issuer, audience, expiry, optional domain). The user id is the token's `sub`.
- **Database:** Neon Postgres, one `sessions` table (`migrations/0001_sessions.sql`). Every row has a `user_id`, and every query in `apiRoutes.mjs` is scoped to the signed in user.

So all three main tests apply: the access-control test, the AI rate limit test and the key search.

## 2. What I checked

1. Access control with two Google accounts on the live site.
2. AI route rate limiting on `/api/chat`.
3. Secret key search of the repo, git history and live site code.
4. Private storage. The app stores no uploaded files. Saved sessions live in the `sessions` table, or in git-ignored `transcripts/live/` files when there is no database.
5. Spending caps and rate limits: `DAILY_CALL_CAP`, `USER_CALLS_PER_HOUR`, `USER_SESSIONS_PER_DAY`, `RATE_LIMIT_MAX`.
6. `npm audit`.
7. An agent security review against a local server.

## 3. What I found

**Access control (live site, two accounts)**
- Account B reading Account A's session id returned 404.
- Account B deleting it returned 404.

**Rate limit**
- With `USER_CALLS_PER_HOUR=20` on the live site, 30 calls to `/api/chat` returned 200 for calls 1 to 20 and 429 for calls 21 to 30.

**Key search**
- No real keys in tracked files, the live site files or git history.
- The only matches are two fake strings in `tests/auth.test.mjs` lines 147 and 148: 4 history matches, all in that file, across commits `6de9428` and `df88ef8`.
- Live site files returned 0 matches.
- `.env`, `server.mjs`, `package.json`, `migrations/0001_sessions.sql` and `../server.mjs` returned 404 on the live site.
- The untracked local `.env` held real keys that were printed in my terminal output during the check.

**npm audit**
- Found 0 vulnerabilities.
- The one dependency is `@neondatabase/serverless`, installed at 1.2.1 (`npm ls`, local install), range `^1.2.1` in `package.json`.

**Agent security review** (Opus 5.5, local server only, nothing edited)

| # | Severity | Finding |
|---|---|---|
| 1 | Medium-high | Anonymous `/api/transcript` writes when live AI is off and there is no database |
| 2 | Medium | Per-IP limit bypass through the first `x-forwarded-for` entry |
| 3 | Medium | Four free Google accounts can use up the daily cap |
| 4 | Low-medium | `/api/chat` forwarded messages unchecked |
| 5 | Info | The save response revealed the saved file name |

Attacks that did not work: origin and Host tricks, forged or expired Google tokens, reading or deleting another user's data, off-list models and huge `max_tokens`, paths outside `public/`, error text leaks, and the live AI switch.

Stored script injection was only checked by reading code, so it has not been tested live.

## 4. What I fixed

| Issue | Fix | Commit |
|---|---|---|
| Real keys printed in terminal output | Rotated the OpenRouter key and both Neon passwords | Not a code change |
| Review 1: anonymous transcript writes | Login required for `/api/transcript` outside localhost, and the response no longer includes the file name (also covers review 5) | Not in `main` yet |
| Review 2: `x-forwarded-for` bypass | `TRUSTED_PROXY_HOPS`, entry taken from the right | Not in `main` yet |
| Review 3: daily cap used up by free accounts | `ALLOWED_GOOGLE_DOMAIN` set in Render | Not a code change |
| Review 4: `/api/chat` as a general proxy | Roles, content types and message count validated | Not in `main` yet |
| Connection string could reach logs | `DATABASE_URL` cleaned before use; save failures log `[save-failed]` with error name and message only | `3e22ef6` (Fix database url, #9) |

## 5. Remaining issues and risks

- **Stored script injection** has not been tested live.
- **No Content-Security-Policy** yet, because the PostHog snippet is inline (AGENTS.md section 2).
- **In-memory limits:** the rate limits, the per user hourly limit and the daily cap are kept in memory. They reset on every restart or deploy and are not shared between instances.
- **Proxy trust:** the `x-forwarded-for` fix depends on how many proxies Render puts in front of the app.
- **Temporary file storage:** without `DATABASE_URL`, sessions are written to the instance's disk, which Render wipes on every deploy and restart on the free plan.
- **Saved data is not managed:** `transcripts/live/` has no cleanup, and partial and full saves of one session are not merged (AGENTS.md section 11).
- **Backups hold real transcripts:** they are kept in the git-ignored `backups/` folder on the builder's machine and must not be shared.
- **Secret scan blind spots:** the CI secret scan skips `tests/` and `.github/`, so a real key placed there would not be caught.
- **Rotated key exposure:** the keys printed in terminal output were rotated.

## 6. Checks that run on every pull request

`.github/workflows/ci.yml` runs one job named `test` on every pull request to `main` and every push to `main`. Render deploys only after it passes.

| Step | What it catches |
|---|---|
| `npm ci` | A `package-lock.json` that does not match `package.json`, or a dependency that fails to install |
| `node --check server.mjs` | A syntax error in the server |
| `npm test` | Regressions in the offline tests, including token checks, per user scoping, rate limits, transcript validation and connection string redaction |
| `npm audit --audit-level=high` | A known high or critical vulnerability in a dependency |
| Secret scan | A tracked file (outside `tests/` and `.github/`) matching an OpenRouter, Anthropic, OpenAI, Stripe, Supabase, PostHog personal or Neon key pattern, or a `postgres://user:password@` string. It prints only file and line, never the secret |

## 7. Attack log

Five attacks from `attack-log.md`:

| Attack | How I tried it | What happened | What I changed |
|---|---|---|---|
| Account B reads Account A's saved session | Signed in as B on the live site, `GET /api/sessions/<A's id>` from the browser console | 404 Not Found | Nothing needed |
| Account B deletes Account A's saved session | `DELETE` of the same id from the console | 404 | Nothing needed |
| Rate limit | 30 POSTs to `/api/chat` in a loop with `USER_CALLS_PER_HOUR` set to 20 | 200 for calls 1 to 20, 429 for calls 21 to 30 | Limit set back to 150 |
| Anonymous transcript writes with live AI off and no database (agent review, medium-high) | curl with no token and no Origin, 21 calls | 200 and 21 files written | Login required for `/api/transcript` outside localhost, the response no longer includes the file name |
| Per-IP rate limit bypass with x-forwarded-for (medium) | Rotating the first forwarded entry with `RATE_LIMIT_MAX=3` locally | Limit bypassed | `TRUSTED_PROXY_HOPS`, entry taken from the right |

The full log of 16 entries is in `attack-log.md`.

## 8. Rules, rollback and backups

### Rules the agent follows

- **Instructions:** coding agents follow `AGENTS.md`, which `CLAUDE.md` imports.
- **Ask me first:** the agent must stop and ask before deleting or changing database data, changing the schema, touching keys, secrets, env vars or permissions, adding a paid service or raising a limit, force-pushing, deleting files outside the task, installing dependencies, or running migrations against production.
- **Merging:** agents never merge. A human merges after the `test` check is green.
- **Enforced settings:** `.claude/settings.json` denies reading `.env` and `.env.*`, `git push --force` and `gh pr merge`.

### How a bad deploy is rolled back

The steps are in AGENTS.md under "Roll back". The drill took about 20 minutes:

1. In Render, open the service and click Events in the left menu.
2. Find the deploy from before the most recent merge (the attack-log pull request), open its menu, choose Rollback, and confirm. Render says free services include rollbacks (Render docs).
3. When it finishes, open `https://ra-practice.onrender.com/healthz`. The commit must be the earlier one.
4. Render turns Auto-Deploy off after a rollback, so open Settings and set Auto-Deploy back to After CI Checks Pass.
5. In Pi, type `/new`, switch to `anthropic/claude-sonnet-5.5`, and send: "Revert the most recent merge into main (the attack-log pull request) with git revert on a new branch, open a pull request with gh pr create, run gh pr checks --watch, then stop and ask me before merging." Merge it on GitHub when checks pass, wait for Render, and confirm `/healthz` shows the revert commit.

If spend is the problem, set `LIVE_AI_ENABLED=false` in Render first: it stops all AI calls at once.

### How production data is backed up

- `scripts/backup-sessions.mjs` exports the whole `sessions` table to `backups/sessions-YYYY-MM-DD.json`.
- It runs one read-only `SELECT`, never prints the connection string, and writes the file readable by the owner only.
- `backups/` is git-ignored because the file holds real transcripts.
- Run it with `node scripts/backup-sessions.mjs`. It reads `DATABASE_URL` from the environment, then `.env`.

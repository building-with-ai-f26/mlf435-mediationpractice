# Attack log

| # | Attack | How I tried it | What happened | What I changed |
|---|---|---|---|---|
| 1 | Account B reads Account A's saved session | Signed in as B on the live site, `GET /api/sessions/<A's id>` from the browser console | 404 Not Found [confirm B's own list showed only B's session] | Nothing needed |
| 2 | Account B deletes Account A's saved session | `DELETE` of the same id from the console | 404 [confirm A's row still exists in Neon] | Nothing needed |
| 3 | Listing and reading sessions without signing in | Same calls with no `Authorization` header | [401, confirm] | Nothing needed |
| 4 | Rate limit | 30 POSTs to `/api/chat` in a loop with `USER_CALLS_PER_HOUR` set to 20 | 200 for calls 1 to 20, 429 for calls 21 to 30 | Limit set back to 150 [confirm] |
| 5 | Secret key search | grep of tracked files, live site files and git history for key and connection string patterns | Only two fake strings in `tests/auth.test.mjs` (4 history matches, all that file); live files 0; protected paths 404 | Real keys found only in the untracked local `.env`, which was printed in my terminal output, so I rotated the OpenRouter key and both Neon passwords [confirm] |
| 6 | Dependency audit | `npm audit` | 0 vulnerabilities | Nothing needed |
| 7 | Anonymous transcript writes with live AI off and no database (agent review, medium-high) | curl with no token and no Origin, 21 calls | 200 and 21 files written | Login required for `/api/transcript` outside localhost, the response no longer includes the file name [commit] |
| 8 | Per-IP rate limit bypass with x-forwarded-for (medium) | Rotating the first forwarded entry with `RATE_LIMIT_MAX=3` locally | Limit bypassed | `TRUSTED_PROXY_HOPS`, entry taken from the right [commit, live loop result] |
| 9 | Daily cap used up by four free Google accounts (medium) | Simulated with the real route logic | Real RAs locked out until UTC midnight | `ALLOWED_GOOGLE_DOMAIN` set in Render [confirm domain] |
| 10 | `/api/chat` used as a general proxy (low-medium) | Arbitrary roles, system prompts and image URLs sent to the validator | Accepted unchanged | Roles, content types and message count validated [commit] |
| 11 | Origin and Host header tricks | evil.example, null, uppercase, suffix and trailing slash variants | All got 403 | Nothing needed |
| 12 | Forged and expired Google tokens | Missing, garbage, alg none, HS256, unknown key id, expired, wrong audience, wrong issuer, payload swapped after signing | All rejected with 401 | Nothing needed |
| 13 | Reading other users' data | `user_id`, `userId` or `sub` set to the victim in the body; ids in uppercase, with `../`, SQL text and `%00` | Stored as the caller or 404, never another user's data | Nothing needed |
| 14 | Model, token and path abuse | Off-list models, huge `max_tokens`, `../` and encoded paths, `.env` | Refused, capped, or 403 and 404; canary file never served | Nothing needed |
| 15 | Script injection through saved text | [live test from Step 8] | [result] | [what I changed] |
| 16 | Rollback drill | Rolled back in Render, then reverted by pull request | [time and result] | Not a vulnerability, a recovery check |
| 17 | Signed-out and forged-token calls to `/api/tts` (read-aloud) | Local server with `TTS_PROVIDER=stub`, `curl -X POST /api/tts` with no `Authorization`, and with `Bearer abc.def.ghi` | 401 `Please sign in with Google to continue.` both times; the provider was never called | Nothing needed. Login is checked before the body is read |
| 18 | Oversized text to `/api/tts` | Local server: a 5000 character body by `curl` got 413. A signed-in 601 character text is covered by the offline test `/api/tts: oversized text is refused` (stub verifier), not by a live call | 413 for the 5000 character body; 400 for 601 characters, refused before the provider; exactly 600 accepted; the refused call did not use the daily cap | Nothing needed. Body capped at 4 KB, text at 600 characters |
| 19 | Read-aloud used outside Voice mode, or with a chosen voice (offline tests) | Signed-in user who never chose Voice calls `/api/tts`; a body with `voiceId: "attacker-voice"`; user 2 calling while user 1 is in Voice mode | 409 in text mode; the voice id in the body is ignored (the server uses the resident's id from `config.js`); one user's mode does not open voice for another | Nothing needed. The mode is held per user on the server, in memory |

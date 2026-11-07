# FIXES.md: Plan for nine small commits

Status: PLAN APPROVED. No code has been changed yet. Commit 1 has not started.

Decisions recorded after review:
1. The model list stays duplicated between `server.mjs` and `public/app.js`. Each copy gets a comment saying the two lists must match. No shared `models.json`.
2. `public/logic.js` is an ES module and `app.js` is loaded as `type="module"`. Commit 1 also fixes the DOM destructuring so module strict mode works.
3. The path traversal item in commit 7 is defense in depth. It could not be reproduced, so it is not described as a confirmed exploit.

Ground rules (from AGENTS.md section 6): one focused change per commit, verify each one, stop and ask if a fix fails twice, no secrets in code, no em dashes in user-visible copy.

Grader models stay as they are in `public/app.js` today:
`deepseek/deepseek-chat`, `anthropic/claude-haiku-5.5`, `google/gemini-2.5-flash`. Commit 9 changes the docs to match the code, not the other way around.

## Test setup (introduced in commit 1, reused after)

- Runner: built-in `node --test`. No `npm install`, no new dependencies.
- Pure logic goes in a new file `public/logic.js`, an ES module with named exports (`export function ...`). `app.js` imports from it (`import { getResponder } from "./logic.js"`) and tests import the same file directly. No `window` globals, no `module.exports`. `app.js` itself stays untestable because it touches the DOM at load time, so it should keep only wiring.
- `public/index.html` loads `app.js` with `<script type="module" src="app.js"></script>`. Module scripts are deferred and always strict, which commit 1 accounts for.
- `logic.js` must not touch `window`, `document`, or `localStorage`.
- Tests live in `tests/*.test.mjs`. Run all with `node --test tests/`.
- Server tests (commits 7 and 8) start `server.mjs` as a child process on a random port and use real HTTP requests.

---

## 1. Route the speaker from the current RA message with a pure `getResponder`

**Problem.**
- In `determineNextSpeaker`, `"\balex\b"` is a normal string, so `\b` becomes a backspace character. The regex never matches and the function always returns `expectedNext`.
- In `send()`, the responder is `session.nextSpeaker`, which was computed from the previous RA message. Routing happens one turn late.

**Change.**
- Add `getResponder(raText, lastResident)` to `public/logic.js`. It uses regex literals (`/\balex\b/i`, `/\bjordan\b/i`), has no side effects, and returns `"Alex"` or `"Jordan"`.
  - Only Alex is named: return Alex.
  - Only Jordan is named: return Jordan.
  - Both or neither is named: return the resident who did not speak last (alternate).
- `send()` calls `getResponder(text, session.lastResident)` before the API call. It uses the result as the speaker and sets `session.lastResident` to it afterward.
- Delete `determineNextSpeaker`. Replace `session.nextSpeaker` with `session.lastResident` (set to `"Jordan"` after the intros).
- Make `logic.js` an ES module (`export function getResponder`) and add `import { getResponder } from "./logic.js";` at the top of `app.js`.
- Change the script tag in `public/index.html` to `<script type="module" src="app.js"></script>`.
- Fix the DOM destructuring in `app.js` (lines 23 to 41). `const DOM = { setup, chatView, ... } = { ... }` declares only `DOM`. The names `setup`, `chatView`, `raNameInput` and the rest are assigned as implicit globals, which works in a classic script but throws `ReferenceError` in strict mode. Replace it with a plain `const DOM = { setup: $("setup"), ... };` and leave all `DOM.x` call sites unchanged. First grep that nothing uses the bare names (`setup`, `chatView`, and so on) outside `DOM.`.

**Files:** `public/logic.js` (new), `public/app.js`, `public/index.html`, `tests/getResponder.test.mjs` (new).

This commit is a little larger than the others because the module switch and the strict mode fix must land together. Without the destructuring fix the app fails at load as a module. Keep `getResponder` and its test as the only new logic.

**Test (`tests/getResponder.test.mjs`).**

| RA text | lastResident | Expected |
|---|---|---|
| "Alex, what would help?" | Alex | Alex (named wins over alternation) |
| "Jordan, what time do you get back?" | Jordan | Jordan |
| "alex how are you" (lowercase) | Jordan | Alex |
| "Alex's side makes sense" | Jordan | Alex |
| "Alexandra, hi" | Jordan | Jordan (no match, alternate) |
| "I hear both of you" | Alex | Jordan |
| "I hear both of you" | Jordan | Alex |
| "Alex and Jordan, thoughts?" | Alex | Jordan (both named, alternate) |
| "" | Alex | Jordan |

Include one regression case showing that the old string-based pattern fails: `new RegExp("\balex\b", "i").test("Alex, hi")` is `false`.

**Manual check.** Serve with `node server.mjs` (modules need http, not file://). Load the page and confirm there are no console errors (no `ReferenceError`, no module load failure). Start a session with a real key (mock mode does not exist until commit 8). Type "Jordan, ..." right after the intros. Jordan must answer on that same turn, not the next one.

**Risk.** Ambiguous messages ("Alex and Jordan...") fall back to alternation. This is a known limitation.

---

## 2. Include mood and stance in `mediationPrompt`

**Problem.** `mediationPrompt` only says "You are Alex. Difficulty: medium." The model has no mood or stance after the intro turns, so it drifts out of character. The `d` variable is computed and never used. The prompt also hardcodes "Alex: needs quiet / Jordan: needs freedom".

**Change.**
- Store `session.profiles = getProfiles(topic, difficulty)` in `startSession`.
- Add a `profile` argument: `mediationPrompt(topic, difficulty, history, speaker, turnCount, profile)`.
- Put the speaker's own `meta`, `trait`, `mood`, and `stance` in the prompt. Do not include the other resident's mood or stance, since residents should not know each other's inner state.
- Remove the unused `d` and the hardcoded needs line.
- Move `mediationPrompt` into `public/logic.js` so it can be tested. If that is too much movement for one commit, test it by extracting only the string builder.

**Files:** `public/app.js`, `public/logic.js`, `tests/mediationPrompt.test.mjs` (new).

**Test.** Build a prompt for Jordan with the `noise` / `hard` profile. Assert it:
- contains Jordan's `mood` and `stance` strings,
- does not contain Alex's `stance` string,
- still contains the transcript and the "MAXIMUM 2 paragraphs" rule,
- contains the turn 4 and turn 6 pressure text only at the right `turnCount` values (3, 4, 6).

**Risk.** Longer prompt, slightly higher cost per turn. Negligible.

---

## 3. Make `max_tokens` a parameter of `call()`

**Problem.** `max_tokens: 200` is fixed for every call. That is right for 2-paragraph resident replies but truncates the graders (score plus 4 bullets) and the consolidator (score plus 7 bullets). A truncated reply drops the last sections and breaks parsing.

**Change.**
- Add `buildRequestBody(model, messages, maxTokens)` to `public/logic.js`. It returns the JSON object sent to the server.
- Change the signature to `call(model, messages, maxTokens = 200)`.
- Named constants at the top of `app.js`: `TOKENS_RESIDENT = 200`, `TOKENS_GRADER = 600`, `TOKENS_CONSOLIDATOR = 700`. Pass the right one at each call site.
- Log a console warning when `choices[0].finish_reason === "length"` so truncation is visible.

**Files:** `public/app.js`, `public/logic.js`, `tests/buildRequestBody.test.mjs` (new).

**Test.**
- `buildRequestBody("m", [], 600).max_tokens === 600`.
- Default (no third argument at the `call` layer) yields 200.
- Body always includes `model`, `messages`, `temperature`.

**Manual check.** Run a full session. Each grader card shows both strengths and both gaps, and the consolidated debrief has all three sections plus "One thing to try".

**Risk.** Graders cost more output tokens. At these limits the cost is small, but record it for T031/T045.

---

## 4. Remove the `m.reasoning` fallback

**Problem.** `call()` returns `m.content || m.reasoning || ""`. If `content` is empty, the chain-of-thought text is shown as the resident's speech or used as a grade. That leaks model internals into the chat and the debrief.

**Change.**
- Add `extractContent(data)` to `public/logic.js`. It returns `data.choices[0].message.content.trim()` and throws `Error("Empty model response")` if `choices` is missing, `content` is not a string, or the trimmed result is empty.
- `call()` uses it. The existing grader `catch` already turns a throw into a visible "Grading failed" card. The chat path already shows `Error: ... Try again.`

**Files:** `public/app.js`, `public/logic.js`, `tests/extractContent.test.mjs` (new).

**Test.**
- Normal response returns trimmed content.
- `{content: "", reasoning: "thinking..."}` throws and never returns "thinking...".
- `{content: null}` throws.
- `{choices: []}` and `{}` throw.

**Risk.** A model that only fills `reasoning` will now fail loudly instead of silently. That is intended. `deepseek-chat`, Claude Haiku, and Gemini Flash normally fill `content`.

---

## 5. Compute the overall score in code

**Problem.** The consolidator is asked to average three numbers. LLMs get arithmetic wrong. A failed grader returns `score: 0`, which is also averaged in, and `parseGrading` returns 0 when it cannot find a score. A broken grader is therefore shown as a real zero.

**Change.**
- `parseGrading` returns `score: null` when no `SCORE:` is found. The grader `catch` also returns `score: null`.
- Add `computeOverallScore(gradings)` to `public/logic.js`. It averages only numeric scores, clamps each to 0..100, rounds to an integer, and returns `null` if none are valid.
- `consolidatorPrompt` is told the computed score and is told to not output a score line. `renderConsolidated` renders the score from code and ignores any `OVERALL SCORE` line in the model text.
- `renderGraderCards` shows "n/a" when a score is `null`.

**Files:** `public/app.js`, `public/logic.js`, `tests/computeOverallScore.test.mjs` (new).

**Test.**
- `[80, 70, 90]` gives `80`.
- `[80, 71]` gives `76` (rounds 75.5 up).
- `[80, null, 60]` gives `70` (null skipped, not counted as 0).
- `[null, null, null]` gives `null`.
- `[150, -5]` gives `50` (clamped to 100 and 0).
- Also test `parseGrading` returns `score: null` for text with no score line, if it is moved into `logic.js` in this commit.

**Risk.** Debrief shows a different number than before in cases where the LLM averaged wrongly. That is the point.

---

## 6. Tighten `checkAutoEnd`

**Problem.**
- Patterns are loose: `/sounds (good|fair|reasonable)/`, `/(let|can we) (commit|start|try...)/` match questions and partial agreement ("Can we try to be quieter? I doubt it").
- `alexAgreed` / `jordanAgreed` never reset, so one early "sounds good" counts forever even if that resident later pushes back.
- The function mixes matching and state changes and has `console.log` noise.

**Change.**
- Add pure `isConfirmation(text)` to `public/logic.js`:
  - false if the text contains a `?`,
  - false if it contains a hedge or reversal (`but`, `however`, `i doubt`, `not sure`, `don't think`, `won't`),
  - otherwise true only if it matches one of a smaller set of explicit commitments (`i agree to`, `that works for me`, `i'm willing to try`, `deal`, `yes, i'll ...`).
- Add pure `bothAgreed(history)` or equivalent. It looks at each resident's latest message, so an agreement is cancelled when that resident's later message is not a confirmation.
- `send()` uses these, shows the "reached an agreement" system line only when both hold, and drops the persistent flags (or keeps them as derived values only).

**Files:** `public/app.js`, `public/logic.js`, `tests/agreement.test.mjs` (new).

**Test.**

| Text | Expected |
|---|---|
| "That works for me. I'll keep it down after 10." | true |
| "Can we try quiet hours?" | false (question) |
| "That sounds fair, but I doubt it will last." | false (hedge) |
| "I agree with the idea, I just don't think it works." | false |
| "Deal, let's start tonight." | true |

History tests:
- Alex confirms, then Jordan confirms: both agreed.
- Alex confirms, Jordan confirms, Alex later pushes back: not both agreed.
- Only one resident ever confirms: not both agreed.

**Risk.** False negatives: the app may not suggest ending when a real agreement happened. This is safer than the current false positives, and the End button always works.

---

## 7. Harden `server.mjs`

**Problems found in the current file.**
- **Path traversal (defense in depth):** `path.join(cwd, "public", pathname)` does not check that the result stays inside `public/`. I could not reproduce a leak of `.env`, so this is a hardening step, not a confirmed exploit. The file holds the API key, so the check is cheap insurance.
- `Access-Control-Allow-Origin: *` lets any web page the user visits send requests to `localhost:3000/api/chat` and spend their key.
- Listens on all interfaces by default (no host passed to `listen`).
- Request body has no size limit.
- The proxy forwards any model and any `max_tokens`, so the key can be used for expensive models.
- No timeout on the upstream `fetch`. Upstream status codes are collapsed to 500.
- Static files are read synchronously and the method is not checked. `url` decoding is not handled.

**Change (one file, `server.mjs`).**
- Resolve the static path, decode it safely, and refuse anything that does not start with the resolved `public/` directory (403 or 404). Serve only GET and HEAD.
- Remove the CORS headers (the app is same-origin). Keep handling `OPTIONS` with 204 and no allow headers.
- `server.listen(PORT, "127.0.0.1")`. Read `PORT` from env with default 3000.
- Cap the request body at 64 KB (413 above that). Return 400 on invalid JSON.
- Allowlist the models used by the app. The list is a constant in `server.mjs`, duplicated from `GRADER_MODELS`, `MAIN_MODEL` and `CONSOLIDATOR_MODEL` in `app.js`. Put a comment above each copy: `// Keep in sync with <other file>. The two lists must match.` Commit 9 adds a test that catches drift. Reject others with 400. Clamp `max_tokens` to at most 1000. Forward only `model`, `messages`, `temperature`, `max_tokens`.
- `AbortSignal.timeout(60000)` on the upstream request. Pass through the upstream status for 4xx/5xx instead of always 500, and use the shape `{ error: { message } }` so the client's `data.error?.message` works. The current server sends `{ error: "string" }`, so the client shows "API error" and loses the message.
- Add `X-Content-Type-Options: nosniff`.

**Files:** `server.mjs`, `tests/server.test.mjs` (new).

**Test (child process on a random `PORT`, fake key in env, raw `http.request` so the path is not normalized by `fetch`).**
- `GET /` returns 200 and HTML.
- Defense in depth check: `GET /../.env`, `GET /%2e%2e/.env` and `GET /..%2fserver.mjs` do not return file content (403 or 404), and the response body does not contain `OPENROUTER_API_KEY`. These probably pass before the change too. They are regression guards, not a failing test that proves a bug. Say so in the commit message.
- `POST /api/chat` with a body over 64 KB returns 413.
- `POST /api/chat` with invalid JSON returns 400.
- `POST /api/chat` with a model not on the allowlist returns 400 (no upstream call is made).
- Response has no `Access-Control-Allow-Origin` header.
- Server is reachable on 127.0.0.1.

(The upstream path is covered in commit 8 with mock mode so tests never hit OpenRouter.)

**Manual check.** Full session in the browser still works.

**Risk.** Adding a model later means updating the allowlist. Note this in AGENTS.md (commit 9).

---

## 8. Add mock mode and a 10-turn cap

**Problem.**
- Every manual test spends real money and needs a key. There is no way to run the app or the server tests offline.
- A session can run forever. Cost grows and the debrief transcript gets long.

**Change.**
- **Mock mode (server side):** `MOCK_MODE=1` in the environment (or `.env`) makes `/api/chat` return canned OpenAI-shaped responses without calling OpenRouter, and the server no longer exits when the key is missing in this mode. The canned reply depends on the prompt:
  - prompt contains "Grade this RA mediation" returns a well-formed `SCORE: 72/100 / STRENGTHS / GAPS` block,
  - prompt contains "Consolidate" returns a well-formed consolidated block,
  - otherwise returns a two-paragraph resident line.
  The server logs `MOCK MODE: no API calls will be made` at startup. Mock mode is off by default.
- **Turn cap (client side):** add `MAX_TURNS = 10` in `app.js` and a pure `isTurnCapReached(turnCount, max)` in `public/logic.js`. After the RA's 10th message and the resident reply, disable the input and Send, leave End & Debrief enabled, and show a system line: "Turn limit reached. Click End & Debrief to finish." Show a turn counter near the composer.

**Files:** `server.mjs`, `public/app.js`, `public/logic.js`, `public/index.html` (turn counter), `.env.example` (add `MOCK_MODE`), `tests/mock.test.mjs` (new), `tests/turnCap.test.mjs` (new).

**Test.**
- `isTurnCapReached(9, 10) === false`, `(10, 10) === true`, `(11, 10) === true`.
- Server in mock mode with no `OPENROUTER_API_KEY`: starts successfully; a grader-style request returns content that `parseGrading` parses to score 72 with 2 strengths and 2 gaps; a consolidator-style request returns content containing all three section headings; a resident-style request returns non-empty text with at most 2 paragraphs.
- Server not in mock mode and no key: exits with code 1 (existing behavior preserved).
- Manual: run `MOCK_MODE=1 node server.mjs`, play 10 turns, confirm input locks and debrief renders.

**Risk.** The mock detection depends on prompt text. If prompts are edited, the mock must be updated. The mock test catches that.

---

## 9. Sync AGENTS.md and .env.example

**Problems found.**
- AGENTS.md section 5 lists `moonshotai/kimi-k3.1-pro` and `google/gemini-2.0-flash-001`. The code uses `anthropic/claude-haiku-5.5` and `google/gemini-2.5-flash`.
- `.env.example` says "Model used: moonshotai/kimi-k3.1-pro", which is wrong, and does not document `PORT` or `MOCK_MODE`.
- AGENTS.md says "No test suite yet" and has no mock command.
- `.specify/features/roommate-conflict-v1/tasks.md` T015 still says "DeepSeek, Kimi, Gemini".

**Change.**
- AGENTS.md section 5: set the table to the models in the code (grader 2 Claude Haiku, grader 3 Gemini 2.5 Flash). Note that the server allowlist (commit 7) must be updated when a model changes.
- AGENTS.md section 2: add `node --test tests/` for deterministic tests and `MOCK_MODE=1 node server.mjs` for offline runs. Update section 3 with `public/logic.js` and `tests/`. Update the tech stack line (Kimi to Claude).
- `.env.example`: remove the stale model line, add `PORT=3000` and `MOCK_MODE=0` with one-line comments. No real keys.
- tasks.md: change T015 wording and tick off what these nine commits complete.

**Files:** `AGENTS.md`, `.env.example`, `.specify/features/roommate-conflict-v1/tasks.md`.

**Test.** A small `tests/docs.test.mjs` that reads `public/app.js` and `AGENTS.md` and asserts every model id in `GRADER_MODELS` / `MAIN_MODEL` / `CONSOLIDATOR_MODEL` appears in the AGENTS.md models table and in the `server.mjs` allowlist (and the reverse), and that `.env.example` contains no string matching `sk-or-v1-[A-Za-z0-9]{20,}` (placeholder only). This catches future drift.

**Risk.** None for runtime. Docs only.

---

## Order and dependencies

1 and 2 are independent of the server. 3, 4, 5 each touch `call()` or the debrief path, so keep them in this order to avoid conflicts. 6 depends on `logic.js` from commit 1. 7 must come before 8 (mock mode builds on the hardened request handler). 9 is last so the docs describe the final state.

## Notes and open questions

1. `anthropic/claude-haiku-5.5` is kept as requested. I have not verified that this id exists on OpenRouter. If the grader card shows "Grading failed", the id is the first thing to check.
2. Decided: the model allowlist stays duplicated between `server.mjs` and `app.js`, with a comment on each copy saying they must match. Commit 9's drift test covers it.
3. Decided: `logic.js` is an ES module and `app.js` loads as `type="module"`. The destructuring fix is part of commit 1.
4. Decided: the path traversal fix in commit 7 is defense in depth, not a reproduced bug.
5. If any fix fails twice in a row, I stop and report before trying a third approach (AGENTS.md rule 6).

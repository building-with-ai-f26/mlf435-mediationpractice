# Model choice

Written 2026-11-23. Prices and zero retention listings were read from OpenRouter on that date (`/api/v1/models` and `/api/v1/endpoints/zdr`). This file is built up over several changes: models and privacy first (below), then the grader token budget, and more as later changes land.

## Models in use

| Role | Model | Where it is set |
|---|---|---|
| Residents (Alex, Jordan) | `anthropic/claude-haiku-5.5` (replaced `deepseek/deepseek-chat`) | `RESIDENT_MODEL` in `public/config.js`, env `RESIDENT_MODEL` |
| Router | `anthropic/claude-haiku-5.5` | `ROUTER_MODEL` |
| Tagger | `anthropic/claude-haiku-5.5` | `TAGGER_MODEL` |
| Grader 1 "Claude" | `anthropic/claude-haiku-5.5` | `GRADER_1_MODEL` |
| Grader 2 "Gemini" | `google/gemini-3.1-flash-lite` | `GRADER_2_MODEL` |
| Grader 3 "GPT" | `openai/gpt-6-luna` | `GRADER_3_MODEL` |

All model ids are named values in `public/config.js`, each overridable by an environment variable. The server builds its allowlist from them and tells the browser the ids in `/config.json`. The server adds `provider: {zdr: true, data_collection: "deny"}` to every OpenRouter call (`OPENROUTER_ZDR=false` switches it off for one test), and nothing falls back to another model: an OpenRouter "No endpoints found" error fails the call with a clear message and a `[zdr]` log line. Reasoning is off for residents, router, tagger and graders from one config value (`REASONING`).

## Prices (USD per million tokens, input / output)

| Model | Input | Output |
|---|---|---|
| `anthropic/claude-haiku-5.5` | 0.10 | 0.50 |
| `openai/gpt-6-luna` | 0.10 | 0.50 |
| `google/gemini-3.1-flash-lite` | 0.25 | 1.50 |
| `deepseek/deepseek-v4.1-flash` | 0.0498 | 0.1992 |
| `anthropic/claude-sonnet-5.5` | 2.00 | 10.00 |
| `google/gemini-3.6-flash` (retired as a grader) | 0.75 | 3.75 |
| `meta-llama/llama-3.3-70b-instruct` | 0.71 | 0.71 |
| `deepseek/deepseek-chat` (the old resident) | 0.2574 | 1.0287 |

Measured with Haiku 5.5 residents (9 simulated sessions): about $0.005 per user session and about $0.00025 per call. `DAILY_CALL_CAP` counts calls, so 500 calls a day is about $0.13 (a simulation, not real use).

## Zero retention results

"Listed" means the model has an endpoint on OpenRouter's zero data retention list (a listing only). "Live request" means a real request with zdr on was sent and answered (`node tools/zdrcheck.mjs`, 2026-11-23).

| Model | Listed | Live request with zdr on | Safety retention flag in the listing |
|---|---|---|---|
| `anthropic/claude-haiku-5.5` | yes | ok | false |
| `google/gemini-3.1-flash-lite` | yes | ok | **true** |
| `openai/gpt-6-luna` | yes | ok (one earlier call was rate limited upstream, then ok) | false |
| `google/gemini-3.6-flash` | yes | ok for a short reply; cannot grade (see below) | **true** |
| `meta-llama/llama-3.3-70b-instruct` | yes | ok (earlier test, older code path) | false |
| `deepseek/deepseek-chat` | yes | ok (earlier test, older code path) | false |
| `deepseek/deepseek-v4.1-flash` | yes | not tested | false for most endpoints, **true** for one Google endpoint |
| `anthropic/claude-sonnet-5.5` | yes | not tested | false |

Not tested at all: any voice vendor, any other model.


## Stage 4 gate: resident model change (2026-11-23)

Haiku 5.5 has a working zero retention route (listed, and a live request with zdr on succeeded), so the resident change was kept. Gate runs (`tools/simulate.mjs`, 3 runs each, `--max-cost 0.50`, noise, medium, rubric v4 graders):

| Persona | Mean score | Expected | Plans reached |
|---|---|---|---|
| strong | 13.3 | 12 to 15 | 3 of 3 |
| average | 3.3 | 3 to 7 | 0 of 3 (must not) |
| hostile | 0.0 | 0 to 2 | 0 of 3 (must not) |

Every persona's mean is in its expected range, and the strong persona's plan rate is 100 percent (the bar is 75 percent). This is a small sample (9 sessions), a possibility check and not a rate.

## Grader token budget (2026-11-23)

**Rule (builder):** keep reasoning off and the budget at 1500 output tokens, unless any call was cut off by the length limit or the 95th percentile is above 1100; then set 2000 from the one config value (`TOKENS_GRADER` in `public/config.js`).

**Data:** `node tools/report.mjs --dir <folder>`, section (j), over the 700-plus grader calls in the sessions saved on this machine (simulated sessions, about 250 sessions, 2026-11-15 to 2026-11-23). Older sessions did not save token counts, so sizes are estimated as characters / 4 ("estimated"); sessions saved from now on carry the real `completionTokens`. Reasoning tokens are not in the text, but reasoning is off for every grader that allows it.

| Grader model | Calls | Median | p95 | Max | Cut off by the length limit |
|---|---|---|---|---|---|
| `anthropic/claude-haiku-5.5` | 252 | 296 | 471 | 558 | 0 |
| `google/gemini-3.1-flash-lite` | 36 | 128 | 278 | 282 | 0 |
| `openai/gpt-6-luna` | 187 | 261 | 358 | 1213 | **1** |
| `google/gemini-3.6-flash` (retired) | 151 | 53 | 258 | 276 | **98** |
| `deepseek/deepseek-chat` (retired) | 65 | 195 | 447 | 529 | 0 |
| `google/gemini-2.5-flash` (retired) | 56 | 172 | 466 | 502 | 0 |
| `meta-llama/llama-3.3-70b-instruct` (tried) | 9 | 172 | 224 | 224 | 0 |

For `google/gemini-3.6-flash` the visible text is short only because its hidden reasoning used the budget first, which is why 98 of its calls were cut off.

**Choice:** a call from a current grader (`openai/gpt-6-luna`) was cut off, so by the rule the budget is now **2000** (was 1500). It is one value, `TOKENS_GRADER`, and 2000 is also the server's cap on `max_tokens` (`MAX_TOKENS_CAP` in `chatBody.mjs`), so no other limit changes. Typical calls use a fifth of it or less, so cost is unchanged except for rare long replies. Reasoning stays off.

**Caveat:** most numbers are estimates, and one cut-off call in 187 may be a one-off. Rerun section (j) once new sessions with real token counts have been saved; if the 95th percentile stays far below 1100 and nothing is cut off, 1500 could be restored.

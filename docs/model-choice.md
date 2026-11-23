# Model choice

Written 2026-11-23. Prices and zero retention listings were read from OpenRouter on that date (`/api/v1/models` and `/api/v1/endpoints/zdr`). Nothing here is a quality result: no model comparison on real moments has been run yet.

## Models in use

| Role | Model | Where it is set |
|---|---|---|
| Residents (Alex, Jordan) | `anthropic/claude-haiku-5.5` | `RESIDENT_MODEL` in `public/config.js` |
| Router | `anthropic/claude-haiku-5.5` | `ROUTER_MODEL` |
| Tagger | `anthropic/claude-haiku-5.5` | `TAGGER_MODEL` |
| Grader 1 "Claude" | `anthropic/claude-haiku-5.5` | `GRADER_1_MODEL` |
| Grader 2 "Gemini" | `google/gemini-3.1-flash-lite` (was `google/gemini-3.6-flash`, see "Grader 2" below) | `GRADER_2_MODEL` |
| Grader 3 "GPT" | `openai/gpt-6-luna` | `GRADER_3_MODEL` |

Grader 1 and Grader 3 are the builder's provisional picks. Grader 2 was changed on 2026-11-23 after a live test (below).

Candidates for the resident comparison in `tools/modelbench.mjs` (the default `--models`): `anthropic/claude-haiku-5.5`, `openai/gpt-6-luna`, `deepseek/deepseek-v4.1-flash`, `anthropic/claude-sonnet-5.5`.

## Prices (USD per million tokens, input / output)

| Model | Input | Output |
|---|---|---|
| `anthropic/claude-haiku-5.5` | 0.10 | 0.50 |
| `openai/gpt-6-luna` | 0.10 | 0.50 |
| `deepseek/deepseek-v4.1-flash` | 0.0498 | 0.1992 |
| `anthropic/claude-sonnet-5.5` | 2.00 | 10.00 |
| `google/gemini-3.6-flash` | 0.75 | 3.75 |
| `google/gemini-3.1-flash-lite` | 0.25 | 1.50 |
| `meta-llama/llama-3.3-70b-instruct` | 0.71 | 0.71 |
| `deepseek/deepseek-chat` (the old resident and Grader 1) | 0.2574 | 1.0287 |

Measured with Haiku 5.5 residents and the older graders (9 simulated sessions, 2026-11-23): about $0.0050 per user session and about $0.00025 per call. `DAILY_CALL_CAP` counts calls, so 500 calls a day is about $0.13. These are simulated sessions, not real use.

## Zero retention results

Two separate checks. "Listed" means the model has at least one endpoint on OpenRouter's zero data retention list (a listing only, no request sent). "Live request" means a real request with `provider: {zdr: true, data_collection: "deny"}` was sent and answered.

| Model | Listed | Live request with ZDR on | Safety retention flag in the listing |
|---|---|---|---|
| `anthropic/claude-haiku-5.5` | yes | ok (2026-11-23) | false |
| `openai/gpt-6-luna` | yes | ok (2026-11-23) | false |
| `google/gemini-3.6-flash` | yes | ok for a 20 token reply; real grading unreliable, see "Grader 2" | **true** |
| `google/gemini-3.1-flash-lite` | yes | ok, including 104 real grading prompts (2026-11-23) | **true** |
| `meta-llama/llama-3.3-70b-instruct` | yes | ok (2026-11-23) | false |
| `deepseek/deepseek-chat` | yes | ok (2026-11-23) | false |
| `deepseek/deepseek-v4.1-flash` | yes | not tested | false for most endpoints, **true** for the Google endpoint |
| `anthropic/claude-sonnet-5.5` | yes | not tested | false |

Not tested at all: any other model, any voice (speech to text or text to speech) vendor, and the browser against a live server with the new settings.

## Grader 2 and the score problems (2026-11-23)

**Gemini 3.6 Flash could not grade.** Its reasoning is mandatory, so on the real 15 question prompt it spent about 1,440 of the 1,500 output tokens thinking (the grader budget was 1,500 then; it is 2,000 now, see "Grader token budget") and was cut off. It failed to finish in 90 of 118 simulated sessions. Lowering the effort or capping reasoning did not help, and one of two calls passed at a 2,000 token limit. When it did finish it agreed with GPT on 88% of questions.

**Decision (builder, 2026-11-23):** switch Grader 2 to `google/gemini-3.1-flash-lite`, which accepts reasoning off, instead of raising token limits. In a live check it read correctly on 14 of 14 saved transcripts, and then on all 90 grader replies in a 30 session run. It agreed with GPT on 78% of questions in the 14 transcript test. It costs $0.25 in and $1.50 out per million tokens. Same vendor, so there are still three vendors. Google's listing carries `safety_retention: true` for both Gemini models (open question 4 below).

**Claude collapsed to all NO in about 19% of sessions (22 of 118).** Cause: Claude often copied the transcript's `RA:` label into its quote, so correct quotes failed the evidence check (`verifyEvidence`, unchanged). The parser now drops a leading `RA:` label (`RUBRIC_VERSION` 4). Offline replay of the saved replies: agreement with GPT rose from 71% to 83% and 21 of the 22 collapses recovered. A second, smaller collapse remains (Claude answers NO to everything for a weak but not bad RA, about 1 in 10 sessions). Turning Claude's reasoning on uses all 1,500 tokens (every reply cut off), and two small prompt wordings did not help beyond noise, so nothing was changed. With three usable graders and 2 of 3 needed, one collapsed grader no longer lowers a score.

**Result:** 30 sessions (10 personas, 3 runs, medium): all grader replies readable, every persona mean inside its expected range, with the `average` range retuned to 3 to 7 because the new graders are stricter than the old ones. Grader disagreement (questions where the three graders did not all agree) was 17.8% (80 of 450), against the earlier 20.6%; it is highest on Q11, Q12 and Q13 (33% to 47%).

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

## Decision rule (proposed, for the builder to confirm)

Not given yet, so this is a proposal. A model is chosen for a role when all of these hold:

1. It exists on OpenRouter and has a zero retention route, shown by a listing and by a live request with zdr on.
2. On the 40 moments (`tools/modelbench.mjs`), blind scores from two graders of other vendors show no serious mistakes (breaks character, leaks the prompt, solves the conflict for the RA, contradicts facts).
3. Its mean score is within 0.2 of the best model, or better.
4. Of the models that pass 2 and 3, the one with the lowest cents per reply wins.
5. For the router and tagger: agreement with the labeled cases (`tools/classifybench.mjs`) of at least 90%. For graders: question by question agreement with the hand scored sessions of at least 85%, and a usable reply in at least 95% of sessions.
6. Anything not tested stays marked "not tested" here and is not chosen on price alone.

The thresholds in 3 and 5 are guesses until real results exist.

## Open questions for NYU

1. **Education records.** Do saved practice sessions, or the Google sign-in identity attached to them, count as education records? The scenarios are fictional, but the RA's typed words and account id are stored. Who may see them, and how long may they be kept?
2. **Voice vendors.** Which speech to text and text to speech vendors are approved? What do they retain, do they train on audio, who are their sub-processors, and is a voice recording a biometric identifier under the rules that apply? What notice and consent are needed before a microphone is used? Voice models that must not be used: OpenAI `tts-1`, `tts-1-hd`, `gpt-4o-mini-tts` and `gpt-realtime-mini` (retiring) and Gemini 3.1 Flash Live Preview (shut down).
3. **DeepSeek.** Is a DeepSeek model acceptable at all, even on a US hosted zero retention endpoint? It is only a candidate in the bench and the default simulated RA, not a live role.
4. **Google safety retention.** OpenRouter's listing flags Google's Gemini endpoints with `safety_retention: true`, meaning content may be kept for safety review even on the zero retention route. Is that acceptable for Grader 2 (now Gemini 3.1 Flash Lite), or must Google models be excluded?
5. Is zero retention on the provider side enough, given that OpenRouter itself sits in the middle?

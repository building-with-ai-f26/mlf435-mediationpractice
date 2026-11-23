# Model choice

Written 2026-11-23. Prices and zero retention listings were read from OpenRouter on that date (`/api/v1/models` and `/api/v1/endpoints/zdr`). Nothing here is a quality result: no model comparison on real moments has been run yet.

## Models in use

| Role | Model | Where it is set |
|---|---|---|
| Residents (Alex, Jordan) | `anthropic/claude-haiku-5.5` | `RESIDENT_MODEL` in `public/config.js` |
| Router | `anthropic/claude-haiku-5.5` | `ROUTER_MODEL` |
| Tagger | `anthropic/claude-haiku-5.5` | `TAGGER_MODEL` |
| Grader 1 "Claude" | `anthropic/claude-haiku-5.5` | `GRADER_1_MODEL` |
| Grader 2 "Gemini" | `google/gemini-3.6-flash` | `GRADER_2_MODEL` |
| Grader 3 "GPT" | `openai/gpt-6-luna` | `GRADER_3_MODEL` |

The grader picks are provisional (chosen by the builder before any live test). See "Known problem: Grader 2" below.

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
| `google/gemini-3.6-flash` | yes | ok for a 20 token reply; real grading unreliable, see below | **true** |
| `google/gemini-3.1-flash-lite` | yes | ok for one real grading prompt (2026-11-23) | **true** |
| `meta-llama/llama-3.3-70b-instruct` | yes | ok (2026-11-23) | false |
| `deepseek/deepseek-chat` | yes | ok (2026-11-23) | false |
| `deepseek/deepseek-v4.1-flash` | yes | not tested | false for most endpoints, **true** for the Google endpoint |
| `anthropic/claude-sonnet-5.5` | yes | not tested | false |

Not tested at all: any other model, any voice (speech to text or text to speech) vendor, and the browser against a live server with the new settings.

## Known problem: Grader 2

`google/gemini-3.6-flash` has mandatory reasoning, so it ignores "reasoning off". On the real 15 question grading prompt it spends about 1,440 of the 1,500 allowed output tokens on hidden reasoning and the answer is cut off (`finish_reason: length`). In 9 simulated sessions it failed in 4. Settings tried on one real transcript, 2 calls each: low effort and reasoning budgets of 128, 256 and 512 tokens all failed at least once; with a 2,000 token output limit one of two calls passed. A fix needs a larger output limit for this model, which is on the "ask first" list (and the server caps `max_tokens` at 2,000), or a different Gemini. `google/gemini-3.1-flash-lite` accepts reasoning off and produced a readable grading once; `gemini-3.5-flash-lite` and `gemini-3.7-flash` refuse reasoning off.

While Grader 2 fails, only two graders vote and both must say YES, so scores fall (the average persona scored 2 to 3 of 15 against an expected 5 to 9).

Grader disagreement (questions where usable graders did not all agree), 3 runs each of strong, average and solution-pusher: 14.1% (19 of 135), against the earlier 20.6%. This is not a clean comparison: Gemini was missing in 4 of 9 sessions, and the persona mix of the 20.6% figure is not known here.

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
4. **Google safety retention.** OpenRouter's listing flags Google's Gemini endpoints with `safety_retention: true`, meaning content may be kept for safety review even on the zero retention route. Is that acceptable for Grader 2, or must Google models be excluded?
5. Is zero retention on the provider side enough, given that OpenRouter itself sits in the middle?

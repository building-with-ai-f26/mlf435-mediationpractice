# Model choice

Written 2026-11-23. This file is built up over several changes. This part records the grader token budget.

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

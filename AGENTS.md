# AGENTS.md — Coding Agent Operating Manual

> Give this file to your coding agent and check that it is using these instructions. Keep the stack, commands, and ground rules current.

## 1. Project Overview
- **What this repo builds:** A local web application that lets Resident Assistants practice mediating roommate conflicts with AI residents. The RA picks a topic and difficulty, mediates between two AI roommates via text (voice in v2), and receives a graded debrief from 3 AI models.
- **Primary user & core workflow:** A current RA on the builder's Housing Team. Workflow: setup (name, topic, difficulty) → context cards → Alex introduces → Jordan introduces → RA mediates (turn-based) → end session → 3 AI graders + consolidated feedback.
- **Tech stack:** Node.js 20+ (built-in `http` module) / Vanilla HTML+CSS+JS / OpenRouter API (DeepSeek, Kimi, Gemini)

## 2. Commands
- **Install dependencies:** `cp .env.example .env` then add your OpenRouter key. No `npm install` needed.
- **Run locally:** `node server.mjs` → open `http://localhost:3000`
- **Run deterministic tests:** No test suite yet (Build 4)
- **Run model evals:** Manual end-to-end session + debrief verification

## 3. Architecture
- `server.mjs` — Node.js proxy server. Serves static files from `/public` and proxies `/api/chat` to OpenRouter with the key from `.env`.
- `public/index.html` — Single-page app with 3 views: setup, chat, debrief.
- `public/styles.css` — CSS variables, no frameworks. Warm neutral palette (navy + cream), no AI design clichés.
- `public/app.js` — All frontend logic: prompts, API calls, turn management, debrief rendering.
- `.env` — `OPENROUTER_API_KEY=sk-or-v1-...` (NEVER commit)
- `docs/index.html` — Product Page / Living PRD (GitHub Pages from `/docs`)

## 4. API Key Security
- The key lives ONLY in `.env` on the builder's machine.
- The browser sends requests to `localhost:3000/api/chat`; the server adds the `Authorization` header.
- `.env` is in `.gitignore` and must never be staged.
- If the app is ever hosted publicly, the key MUST stay behind a server proxy; never ship it to the client.

## 5. Models Used
| Role | Model | Via |
|------|-------|-----|
| Mediation | `deepseek/deepseek-chat` | OpenRouter |
| Grader 1 | `deepseek/deepseek-chat` | OpenRouter |
| Grader 2 | `moonshotai/kimi-k3.1-pro` | OpenRouter |
| Grader 3 | `google/gemini-2.0-flash-001` | OpenRouter |
| Consolidator | `deepseek/deepseek-chat` | OpenRouter |

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

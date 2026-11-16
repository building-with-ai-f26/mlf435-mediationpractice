# [Project Name]

> **One-line pitch:** [Who is this for, and what job does it do for them?]

- **Builder:** [Your Name] (`@github-handle`)
- **Pod:** [Pod Name / Number]
- **Product Page & Living PRD:** [Add your GitHub Pages URL]
- **App:** runs locally through Week 4; add a cloud URL in Build 5.

## Start here: Build 1

**Due Monday, November 9 at noon, New York time.** No class November 3; keep building that week.

1. Join the [class organization](https://github.com/building-with-ai-f26), then use this template to create a **public** repo named `<netid>-<project-slug>`. Ask Christian or Hew if the organization is missing from the owner list.
2. Set up Git and one coding agent during the week of October 27. Follow the [Icerynk setup guide](https://www.icerynk.com/c/fa26-tech-gb-2160-dm2-f2/content/pre-class-setup-github-openrouter-your-coding-agent).
3. Publish [`docs/index.html`](./docs/index.html): **Settings → Pages → Deploy from a branch → main → /docs → Save**. When deployment finishes, open `https://building-with-ai-f26.github.io/<your-repo-name>/`.
4. Fill in PRD v1: a reachable user, their painful before/after workflow, one core workflow, and three non-goals.
5. Build a rough local prototype. Add a screenshot or GIF and an honest Build 1 log to the Product Page, including progress, learning, problems, costs, and hours.
6. Push meaningful commits on **at least two separate days each week outside class**, including the November 3 break.
7. Submit your **Product Page URL and repository URL in Icerynk**. Come ready to demo the prototype in two minutes on November 10.

Create your PostHog account in Week 1. Install it on the Product Page and local app in **Build 2**, then verify events. The Product Page is public from Build 1; the app can stay local through Week 4.

## Repository map

| File / folder | Purpose |
| --- | --- |
| [`docs/index.html`](./docs/index.html) | Required public pitch, living PRD, and weekly build log. Update with actual work and evidence. |
| [`Intent.md`](./Intent.md), [`Plan.md`](./Plan.md), [`journal/`](./journal/) | Optional drafting aids. No duplicate submission is required. |
| [`AGENTS.md`](./AGENTS.md) | Local run commands, project context, and agent rules. Build 2 onward. |
| [`tests/`](./tests/) | Verification guidance. Build 4 offers Track A domain evals **or** Track B user replays. |
| [`SPONSOR_MEMO.md`](./SPONSOR_MEMO.md) | One-page recommendation backed by actual usage, full costs, and risks. Due December 14 at noon. |

[Icerynk](https://www.icerynk.com/c/fa26-tech-gb-2160-dm2-f2/content) holds the assignment instructions and submissions.

## Run locally

You need **Node.js 20 or newer**. There is no `npm install`: the app uses only Node built-ins.

```bash
git clone https://github.com/building-with-ai-f26/<your-repo-name>.git
cd <your-repo-name>
node --version                 # must print v20 or newer
cp .env.example .env           # then open .env and replace the placeholder with your OpenRouter key
node server.mjs                # open http://localhost:3000
```

Run these from the repo root. The server reads `OPENROUTER_API_KEY` from `.env` and exits with an error if the key is missing. `.env` is git-ignored and the key never reaches the browser. Keep it private.

- **Mock mode (no API calls):** open `http://localhost:3000/?mock=1` for canned replies and grades. The server still needs a key line in `.env` to start.
- **Tests:** `node --test tests/` (169 tests, offline).
- **Tools:** `node tools/probe-models.mjs [--dry]`, `node tools/simulate.mjs --persona strong --dry`, `node tools/report.mjs`. Any run without `--dry` calls OpenRouter and costs money. `simulate.mjs` has more flags (`--scenario`, `--difficulty`, `--runs`, `--ra-model`, `--max-cost`, `--out`); see `AGENTS.md`.
- **Live sessions are saved locally.** When you finish a session on the local server (not mock mode), the app saves a copy to `transcripts/live/YYYY-MM-DD/` with the turns, who answered, openness, grader results, models and token counts. The RA name is stored as "RA". If you close the tab after at least 2 turns and before the debrief ends, a partial copy is saved. `transcripts/live/` is git-ignored. To share a session, run `node tools/export-live.mjs transcripts/live/<date>/<file>.json`, which writes a copy to `transcripts/shared/` with email and phone lines removed. Read it before you commit it.
- **Sync the GitHub Pages demo:** `scripts/sync-demo.sh`, then commit `docs/demo/`.

The full command list, file map, model table, rubric scoring and known gaps are in [`AGENTS.md`](./AGENTS.md).

# Plan: Roommate Conflict Mediation Practice (v1)

## Architecture
- **Server**: Node.js `http` module, no frameworks. Serves static files + proxies `/api/chat` to OpenRouter.
- **Frontend**: Vanilla HTML/CSS/JS. No build step. No frameworks.
- **AI**: OpenRouter API via proxy. Models: DeepSeek Chat (mediation), DeepSeek/Kimi/Gemini (graders).
- **Security**: API key in `.env`, read by server only. Browser calls `localhost`.

## Data Model
- **Session** (in-memory, per tab):
  - raName: string
  - topic: enum (noise | cleaning | guest policy | hygiene | shared items)
  - difficulty: enum (easy | medium | hard)
  - turnHistory: Array<{sender: string, text: string}>
  - active: boolean
- **Profiles** (static lookup by topic + difficulty):
  - alex: {name, handle, meta, trait, mood, stance}
  - jordan: {name, handle, meta, trait, mood, stance}

## Phases

### Phase 1: Setup Screen
- File: `public/index.html` (setup view)
- Fields: name input, topic dropdown, difficulty dropdown, start button

### Phase 2: Context + Chat UI
- File: `public/index.html` (chat view), `public/styles.css`
- Layout: sidebar (resident cards) + main (chat log + composer)
- Cards: color-coded, name/handle/meta/trait/stance

### Phase 3: Mediation Engine
- File: `public/app.js`
- Prompts: Alex intro, Jordan intro, turn-based mediation
- Turn logic: alternate after RA message, track history

### Phase 4: Debrief Pipeline
- File: `public/app.js`
- Parallel calls to 3 graders, then consolidation
- Render: 3 grader cards + consolidated feedback panel

### Phase 5: Server
- File: `server.mjs`
- Static file serving from `/public`
- Proxy `/api/chat` with OpenRouter key from `.env`

## Technical Decisions
- No framework: keeps setup instant, no npm install beyond the one file.
- No voice in v1: reduces complexity, typed input is reliable.
- DeepSeek for mediation: cheap, fast, clean content output.
- 3-model grading: reduces single-model bias, surfaces consensus vs divergence.

## Constraints
- Must run on localhost:3000 with no external auth.
- `.env` must never be committed.
- All prompts must avoid em dashes (enforced by prompt text).

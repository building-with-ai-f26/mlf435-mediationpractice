# Tasks: Roommate Conflict Mediation Practice (v1)

## Phase 1: Foundation
- [x] T001 Initialize project structure and Node.js server (`server.mjs`)
- [x] T002 Create setup screen with name, topic dropdown, difficulty dropdown (`public/index.html`)
- [x] T003 Style setup screen — warm neutral palette, no AI clichés (`public/styles.css`)
- [x] T004 Add resident profile data model (topic × difficulty matrix) (`public/app.js`)
- [x] T005 Render resident context cards in sidebar (`public/app.js`)

## Phase 2: Chat UI
- [x] T006 Build chat layout: sidebar + main area (`public/index.html`)
- [x] T007 Style message bubbles — named, color-coded, no animations (`public/styles.css`)
- [x] T008 Add composer: text input + send button (`public/index.html`)
- [x] T009 Style toolbar and composer (`public/styles.css`)

## Phase 3: Mediation Engine
- [x] T010 Build Alex introduction prompt (first message) (`public/app.js`)
- [x] T011 Build Jordan introduction prompt (second message) (`public/app.js`)
- [x] T012 Implement turn-based mediation loop (`public/app.js`)
- [x] T013 Parse named AI responses (`**Name:**` format) (`public/app.js`)
- [x] T014 Track conversation history for debrief (`public/app.js`)

## Phase 4: Debrief Pipeline
- [x] T015 Build 3 grader prompts (DeepSeek, Claude Haiku, Gemini 2.5 Flash) (`public/app.js`)
- [x] T016 Run 3 gradings in parallel (`public/app.js`)
- [x] T017 Parse grader responses (score + strengths + gaps) (`public/app.js`)
- [x] T018 Build consolidator prompt (merge 3 gradings) (`public/app.js`)
- [x] T019 Render 3 grader score cards (`public/app.js`)
- [x] T020 Render consolidated feedback sections (`public/app.js`)

## Phase 5: Polish
- [x] T021 Add restart flow (return to setup) (`public/app.js`)
- [x] T022 Error handling for API failures (`public/app.js`, `server.mjs`)
- [x] T023 Responsive layout for mobile (`public/styles.css`)
- [x] T024 Git ignore `.env` and machine-local state (`/.gitignore`)
- [x] T025 Update AGENTS.md with run commands
- [x] T026 Commit all files to main

## Phase 2 (Next): Future Builds

### Build 2 (Due Nov 16): Voice + PostHog
- [ ] T027 Add Web Speech API for voice input (primary) with typed fallback
- [ ] T028 Install and verify PostHog on Product Page and local app
- [ ] T029 Update PRD v2 on docs/index.html
- [ ] T030 Add local setup commands to AGENTS.md
- [ ] T031 Cost tracking and spend estimation

### Build 3 (Due Nov 23): Core Workflow End-to-End
- [ ] T032 Expand scenario catalog (8 scenarios from PRD non-goals)
- [ ] T033 PostHog funnel events (session_start, message_sent, debrief_viewed)
- [ ] T034 Real user testing with Housing Team RA
- [ ] T035 Cumulative cost display in debrief

### Build 4 (Due Nov 30): Testing Track
- [ ] T036 Choose Track A (domain eval) or Track B (user replays)
- [ ] T037 10-case domain eval OR 3-5 user replays
- [ ] T038 PRD v4 updates based on evidence

### Build 5 (Due Dec 7): Ship
- [ ] T039 Security audit: no exposed keys, spend cap
- [ ] T040 Cloud deployment (if proceeding) or verified local-only
- [ ] T041 2-minute demo video

## Phase 3: Convergence (2026-11-01 assessment)

- [ ] T042 Add voice input via Web Speech API as primary input method per Constitution III (HIGH/missing)
- [ ] T043 Install and verify PostHog analytics on Product Page and local app per Build 2 requirements (HIGH/missing)
- [ ] T044 Fill AGENTS.md with actual run commands, tech stack, and project context (HIGH/missing)
- [ ] T045 Display cumulative API cost and per-session cost estimate in debrief panel (MEDIUM/missing)
- [ ] T046 Add retry logic for failed grader calls with exponential backoff (MEDIUM/missing)
- [ ] T047 Add visual loading spinner during consolidation phase (LOW/missing)
- [ ] T048 Add keyboard shortcut (Escape) to end session (LOW/missing)

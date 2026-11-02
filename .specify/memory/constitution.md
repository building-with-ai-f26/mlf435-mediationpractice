# RA Practice Scenarios Constitution

## Core Principles

### I. Local-First Prototype
The application runs entirely on the user's machine. No cloud hosting, no accounts, no saved transcripts in v1. The OpenRouter API key lives only in `.env` and never touches browser code or Git.

### II. API Key Security (NON-NEGOTIABLE)
The proxy server is the ONLY component that reads the API key. The browser fetches through `localhost:3000/api/chat`. If the app is ever hosted publicly, the key MUST sit behind a server proxy, never in client bundle or environment-exposed frontend.

### III. Voice Input Fallback
Voice is the primary input method (RA speaks out loud). Typed text is a reliable fallback when speech recognition fails or is unavailable. Either path must work end-to-end.

### IV. Anti-Slop Frontend
No AI design clichés: no fade-up scroll reveals, no teal/cyan accents, no generic card grids, no em dashes in copy, no fake data (Jane Doe), no div-built fake screenshots.

### V. Concise, Action-Oriented Feedback
Debrief content is brief and specific. No filler. Every piece of feedback references a concrete moment from the transcript. Bullet points, not paragraphs.

### VI. Testable with Real Users
Build for a reachable user: a current RA on the builder's Housing Team. Every feature must be demonstrable in person and gatherable for feedback.

## Governance

This constitution guides all builds. Violations are flagged before they reach the user. Amendments require a PR with justification.

**Version**: 1.0 | **Ratified**: 2026-11-01

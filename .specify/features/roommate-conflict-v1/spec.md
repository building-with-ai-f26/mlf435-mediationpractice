# Feature: Roommate Conflict Mediation Practice (v1)

## Overview
A local web application that lets Resident Assistants practice mediating a roommate conflict between two AI residents. The RA selects a topic and difficulty, then mediates via typed text (voice in v2), receiving a graded debrief from 3 AI models.

## Functional Requirements

### FR-001: Session Setup
The RA enters their name, selects a conflict topic from a dropdown (noise, cleaning, guest policy, hygiene, shared items), and selects a difficulty (easy, medium, hard).

### FR-002: Context Cards
Before mediation begins, two resident profile cards display on screen showing name, age, year, major, personality, current mood, and their position on the conflict. Cards are color-coded per resident.

### FR-003: AI Resident Introductions
Alex introduces first (name, year, major + frustration). Jordan introduces second (name, year, major + pushback on Alex's version). Both messages appear as separate, named messages in the chat.

### FR-004: Turn-Based Mediation
After introductions, the RA types a response. The AI residents alternate responding, staying in character. Each response is 2-4 sentences, addressing the RA directly. Difficulty affects emotional intensity and resistance.

### FR-005: End Session
The RA clicks "End & Debrief" at any time. The session terminates and grading begins.

### FR-006: 3-AI Grader Debrief
The full transcript is sent to 3 different models (DeepSeek, Kimi, Gemini) in parallel. Each returns a score (0-100) plus strengths and gaps.

### FR-007: Consolidated Feedback
A 4th model consolidates the 3 gradings into one score (average), plus three sections: What You Did Well, What You Missed, One Thing to Try Next Time. All feedback is concise, action-oriented, with no em dashes.

### FR-008: Restart
The RA can start a new session, returning to the setup screen with all fields cleared.

## Success Criteria

- SC-001: An RA can complete a full session (setup → mediate → debrief) in under 5 minutes.
- SC-002: The server starts with a single command (`node server.mjs`) and needs no additional config beyond `.env`.
- SC-003: 3 gradings return within 20 seconds on a typical connection.
- SC-004: The debrief references specific transcript moments (not generic advice).

## User Story
As a current RA, I want to practice a roommate mediation alone so that I feel prepared before my first real conflict.

## Edge Cases
- Grader model fails: display fallback message, continue with available gradings.
- No name entered: default to "You".
- API returns malformed response: parse gracefully, show error in chat.

## Out of Scope (v1)
- Voice input (v2)
- Saved transcripts or accounts
- Public hosting
- Scenarios beyond roommate conflict
- Real-time coaching during mediation

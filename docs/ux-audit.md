# Front-end audit (2026-11-23)

Method: read `public/index.html`, `styles.css` and `app.js`, then drove the real app in Chrome (mock mode, `?mock=1`) through setup, a chat of two turns, and the debrief, at 1280 by 800 and 390 by 844, measuring positions and viewing screenshots. Not covered: sign-in with a real Google account, voice mode, a real long session, screen readers, and any browser except Chrome.

## Fixed in this change

| Finding | What a user saw | Fix |
|---|---|---|
| Difficulty wording was long and partly wrong ("Cooperative") | Easy, Medium, Hard with long descriptions | **Level 1: Open to talking**, **Level 2: Frustrated, defensive**, **Level 3: Angry, slow to trust**. Badges and the debrief say "Level 2". Saved sessions still store easy, medium and hard. |
| Badges showed raw values | "noise", "medium" in the sidebar | "Noise Complaint", "Level 2" |
| Debrief opened scrolled part way down | The feedback header was cut off after ending a session | Page scrolls to the top when the debrief opens and when a new session starts |
| Pinned toolbar was tall on phones | The hint text squeezed into a narrow column, about 150 px (18 percent of the screen) pinned | Two rows (name and buttons, then the progress bar and a one-line hint), about half the height |
| Turn counter clipped on phones | "Turn 2 of 15" ran off the right edge | Sits on its own line under the message box on phones |
| Sidebar heading clipped on desktop | "Residents" was cut off once the page was scrolled to the bottom (the sidebar was 35 px above the window) | Sidebar is as tall as its content and sticks at the top |
| Progress hint text too faint | Contrast 3.9 to 1 (the reading standard is 4.5 to 1) | Opacity removed, contrast 5.4 to 1 |
| Hint button gave noise-only examples in every topic | In "Hygiene Concern": "what time do you get back from evening classes?" | Examples are topic-neutral, and the button first repeats what the progress bar currently suggests |
| Failed grader chip showed technical text | "...(finish_reason: length)" | "could not score this time" (details stay in the console) |
| Screen readers heard nothing new | Messages, "Residents are thinking" and the hint were silent; the message box had only a placeholder | The conversation is a polite live region, the loading text is a status, the box has a label |

## Recommended next (not done, each needs a decision)

1. **Confirm before "End & Debrief".** One accidental click ends the session, cannot be undone, and sends it to three paid graders. A two-step button ("End and see feedback?" for a few seconds) is enough.
2. **Typing indicator in the chat.** "Residents are thinking..." appears under the toolbar, far from where the eye is. A typing bubble at the end of the conversation would feel like a live chat.
3. **Multi-line message box.** It is a single-line input, so long messages scroll sideways and Shift+Enter does nothing. An auto-growing text area (Enter sends, Shift+Enter adds a line) fits mediation messages better.
4. **Setup screen.** "Situation" is a drop-down with one choice. Add one line on what will happen (about 10 minutes, you mediate, you get a checklist) and show the chosen level's description under the drop-down.
5. **Residents on phones.** The resident cards (their stance) sit 350 px above the chat and a new session scrolls past them. A collapsed "Residents" strip with each person's one-line stance would keep them in reach.
6. **Debrief.** Lead with two or three things the RA did well, then the 15-item list; add "see your conversation" and a copy button so the RA can review exact wording. The 10 to 20 second wait only shows one line of text; a step list (graders running) would help.
7. **Turn counter wording.** "Turn 2 of 15" could read "Your message 2 of 15" and warn near the end.
8. **Hint button.** It now repeats the progress hint plus an example; consider renaming it "Example question".
9. **Mock mode shows "RA: RA".** Live mode shows the signed-in first name.

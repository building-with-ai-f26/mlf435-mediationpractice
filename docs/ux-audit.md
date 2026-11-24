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

## Recommendations, all done in the second change

| Recommendation | What was built |
|---|---|
| Confirm before "End & Debrief" | First press turns the button red and says "Press again to end" for 4 seconds; the second press ends. The "plan reached" button still ends at once. |
| Typing indicator in the chat | Three pulsing dots in the conversation where the reply will appear (still announced as "The residents are typing"). The banner under the toolbar is gone. |
| Multi-line message box | A box that grows up to about five lines. Enter sends, Shift+Enter adds a line (in the label and tooltip). |
| Setup screen | The "Situation" drop-down stays as the single option on purpose. Added "Higher levels start more guarded and take longer to trust you." and one paragraph on what happens (10 to 15 minutes, you mediate by typing, 15 item checklist). |
| Residents on phones | The cards sit in a fold-out ("Alex and Jordan: read their situations"), closed on phones so the conversation is what you see, always open on wide screens. |
| Debrief | "What you did well" (up to three met items, with your quote) comes first; "See your conversation" with a Copy button comes last; while grading, a list shows each grader reading, finished, or could not score. |
| Turn counter | "5 of 15 messages sent", "Time to wrap up." for the last two, and a note at the limit. |
| Mock mode "RA: RA" | Shows "You". |
| Hint button | Kept as "Hint": it says what the progress bar suggests, then gives an example. |

Also found and fixed while testing: the "Practice mode" setting was visible even with voice off, because its display rule overrode the hidden attribute (introduced with voice replies).

Not verified: the grading step list in a live session (mock grading is instant, so it never shows), the Copy button's clipboard permission in other browsers, screen readers.

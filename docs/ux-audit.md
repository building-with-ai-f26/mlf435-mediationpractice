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
| Hint button | Kept as "Hint" at first; removed in the sixth change below, because it only repeated the progress hint. |

Also found and fixed while testing: the "Practice mode" setting was visible even with voice off, because its display rule overrode the hidden attribute (introduced with voice replies).

Not verified: the grading step list in a live session (mock grading is instant, so it never shows), the Copy button's clipboard permission in other browsers, screen readers.

## Third change: app-style chat screen and a live sidebar

- **Chat screen.** The chat is now exactly the window high: toolbar fixed at the top, only the conversation scrolls, and the message box is locked to the bottom. The footer line ("Signed in as ...", Sign out, Build ...) sits under the message box. Measured in Chrome at 1280x800 and 390x844: the page height equals the window height, the message box does not move when the conversation scrolls, and the signed-in line returns to the page after the session ends.
- **Sidebar.** It was a static card pair that nobody needs after the first minute. It now shows each resident's mood (a four-step meter: Guarded, Softening, Open to options, Ready to compromise), a checklist of conversation moves (ground rules, invited and reflected each resident, plan, who/what/when), how many times you spoke to each resident, and a soft warning about your last message (taking a side, lecturing, or a solution before both felt heard). All from labels the app already computes each turn. On phones the folded summary reads "Alex: Softening · Jordan: Guarded".

## Fourth change: the page never scrolls

Found by measuring each screen at 1280x800, 390x844 and 1280x520 with the signed-in line switched on: the chat was already locked, but the **setup screen** (911 px of content in an 800 px window) and the **debrief** (2,814 px) scrolled as whole pages, so "Signed in as ... / Sign out / Build ..." sat below the fold. Now `body` is exactly the window high with no page scroll; setup and debrief scroll inside the content area; a footer bar with the signed-in line, Sign out and the build label is always visible on those screens, and during a chat the same line sits under the message box. After the change all nine measurements (three screens at three sizes) show no page scroll and the footer line visible without scrolling.

## Fifth change: live resident cards

The two resident cards were the last static part of the sidebar (name, handle, age, one trait line, one stance line, never changing). They now teach the difference between a position (what someone says) and an interest (what they need), which is the core mediation skill:
- **What they say** stays on the card from the start, and folds away after your first message.
- **What they need** is locked until the resident trusts you (level 2: "Open to options"); **where they could bend** unlocks at level 3. The newly unlocked section flashes once. Checked in Chrome: locked at the start, the two needs listed after four reflective messages.
- **The last thing they said**, quoted, so you do not scroll up to remember their position.
- **Mood trend**: a "warmer" or "cooler" note when trust changed on the last turn.
- **Plan check**: once a plan is on the table and the needs are visible, each card says whether the plan keeps that resident's needs.
- **Suggested question** that changes with trust (how has this been, what matters most, what could you live with, what would you try or give up). Clicking it puts the text in the message box to edit; it never sends.

Not verified: how this feels over a real 15-turn session with live residents, whether unlocking at fixed trust levels matches what live residents actually reveal in the chat (they state needs in their own words and sometimes earlier or later), and screen reader behaviour.

## Final run-through (after all of the above)

Chrome, mock mode, signed-in line injected, the whole flow clicked through (setup, start, three reflective messages, a long multi-line message, End twice, debrief, Start New Session) at six sizes: laptop 1440x900 and 1280x720, tablet 768x1024, phone 390x844, small phone 320x568, phone on its side 844x390. Touch emulation for the tablet and phones.

**Passed everywhere:** no console errors or failed requests (after the favicon fix), no horizontal overflow, the toolbar, message box and footer line never clipped, the page itself never scrolls (checked with real wheel input over the message box, footer line, toolbar, sidebar and conversation, not only with script scrolling), the multi-line box stops growing at five lines with the message box still on screen, restart returns to setup.

**Fixed:**
- A 404 for `/favicon.ico` on first load: added an inline icon.
- Touch targets: Hint, End & Debrief, the sign-out link, the fold-outs and the question chips were 23 to 31 px tall; on touch screens they are now about 40 px (laptops are unchanged).
- Phone on its side: the conversation had about 160 px of height. The message counter now shares a row with the message box, and the bars are slimmer (about 210 px).
- Narrow phones: tighter setup card and dropdown text so "Level 2: Frustrated, defensive" is not cut off as early.

**Still true, not fixed:**
- On a 320 px phone or a phone on its side, "Begin Session" is below the fold of the setup screen and needs a swipe inside the form (it works; the form scrolls, the page does not).
- On a phone on its side the sidebar takes about a third of the width. A "show residents" button instead would give the conversation more room.
- On a laptop the "How it is going" checklist is below the two resident cards and needs a sidebar scroll.
- (The Hint button was removed afterwards, see below.)
- Not testable here: real Google sign-in, live resident replies and voice mode, a screen reader, Safari and Firefox.

## Sixth change: no Hint button, new tab icon

- **Hint button removed.** After the audit it only repeated the progress hint that is always visible in the toolbar ("Both are listening. Ask what each would be willing to try or give up."), plus a random example. The button, its example list and its `hint_clicked` analytics event are gone; the toolbar has the progress bar with its hint, and End & Debrief. The suggested-question buttons on the resident cards cover the "what could I say" need.
- **Tab icon** is the speaking head emoji (U+1F5E3), as an inline image. It is drawn from the system's emoji font, so it looks different on each platform; very old systems without that emoji show a blank square.

## Seventh change: a sidebar that fits

The sidebar scrolled on a laptop: long stance text on each card repeated what the chat intros already say, the "last said" quote repeated the conversation beside it, and the open bend lists made it taller still. Measured in Chrome (the height the content needs against the height the sidebar has, worst case: both residents fully unlocked, the plan check showing, a two line warning):

| Window | Before | After |
|---|---|---|
| 1280x720 (demo banner on, 682 px of sidebar) | scrolled | content ends at 615, 67 px to spare |
| 1366x640 (602 px of sidebar) | scrolled | content ends at 576, 26 px to spare |
| 1440x900 | scrolled | 247 px to spare |

What changed: no stance or "last said" on the cards (one summary line until your first message, then gone); needs shortened by dropping the "because ..." reason (the chat carries it); "where they could bend" is a floating panel that closes on an outside click or Escape; the suggested question is a small "Ask" button beside the name (its tooltip and accessible name say which question); the checklist is two columns with shorter labels; the "live signals" note moved into the heading; the sidebar is 300 px wide; and an extra tightening rule applies to windows under 680 px high. On phones the two cards now stack in the fold-out instead of sitting in a sideways row that cut the second one off.

Not verified: how much a very long need text (a new topic with longer wording) would add, and whether dropping the reason from each need loses anything for a real user.

## Eighth change: the card button follows the conversation

The "Ask" button asked the same question whatever had just happened (it only changed with trust). It is now at the bottom of each card, with a short label that names the next move, chosen from where the conversation is (checked in Chrome with a scripted conversation):

| Where the conversation is | Button |
|---|---|
| Nothing said to this resident yet | Ask how it's been |
| Alex just said "I'm exhausted" and you have not reflected it | Reflect: worn out |
| You reflected them, low trust | Ask what matters most |
| Trust 2 | Ask what they can live with |
| Trust 3 | Ask what they'd give up |
| A plan is on the table and misses their needs | Ask what's missing |
| The plan fits but has no who, what, when | Pin down who, what, when |
| The plan fits and is specific | Ask: does it work? |
| Resolved | Confirm the check-in |

Clicking pastes one sentence (for example "Alex, it sounds like you feel worn out. Is that right?") into the message box for you to edit; it never sends. Open questions you have used are not offered again. The feeling for "Reflect" comes from plain keywords in the resident's last message (worn out, blamed, unheard, stressed, angry, frustrated, hurt and a few more), not from a model, so it is a suggestion and can be wrong. The sidebar still fits in the worst case: 646 of 682 px at 1280x720 and 576 of 602 px at 1366x640 (both with the demo banner, which production does not have).

Not verified: how the suggestions feel against live residents' replies (the keyword feelings and the plan states were tested against the mock conversation and unit tests), and whether the open questions should be offered in a different order.

## Ninth change: card suggestions checked against 138 saved live sessions

Every turn of the 138 saved sessions (2,693 resident replies, real tagger labels) was replayed through the card logic. Found and fixed:

- **"Reflect: worn out" was wrong most of the time.** It fired on 16% of replies, 400 of 430 detections as "worn out", because the keyword `sleep` matched any resident mentioning Alex's sleep (including Jordan). Now it needs a first-person feeling phrase and skips sentences about the other resident or starting "I hear". It fires on 2% of replies (63), mostly Alex saying "I'm just really tired" or "it's exhausting".
- **Solution-pushing RAs got "Ask for an example" 98% of the time.** At low trust with no reflection yet, the button now says "Reflect what you heard".

Confirmed: every one of the 395 resolved turns shows "Confirm the check-in"; the plan states follow the tagger.

Not verified: that a human finds the suggestions helpful, and the 2% detection rate means "Reflect: <feeling>" is rare, so the keyword list is conservative by design.

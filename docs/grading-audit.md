# Live test and grading audit (2026-11-23)

## What was run

30 live sessions through `tools/simulate.mjs` (real models, zero retention on, rubric v4 graders: Claude Haiku 5.5, Gemini 3.1 Flash Lite, GPT-6 Luna), Level 2 (medium): five RA styles by all six scenarios, one session each.

| RA style | Meant to be | Mean score (of 15) | Range | Plans reached |
|---|---|---|---|---|
| strong | strong | **13.7** | 12 to 15 | 5 of 6 |
| rushed-good | medium | 6.8 | 6 to 8 | 0 of 6 |
| average | medium | 6.3 | 4 to 9 | 0 of 6 |
| side-taker | weak | 0.5 | 0 to 1 | 0 of 6 |
| solution-pusher | weak | 0.5 | 0 to 1 | 0 of 6 |

Same ordering in every scenario. All 90 grader replies were usable. Every persona's mean is inside its expected range. The strong RA did not reach a plan in the hygiene scenario (score 15 of 15 anyway: plans and scores are separate things). Cost about $0.35.

Per scenario (met of 15; a star means a plan was reached):

| | noise | cleaning | guest policy | hygiene | shared items | religious |
|---|---|---|---|---|---|---|
| strong | 13* | 13* | 14* | 15 | 12* | 15* |
| rushed-good | 7 | 7 | 8 | 6 | 7 | 6 |
| average | 7 | 5 | 9 | 4 | 6 | 7 |
| side-taker | 1 | 1 | 0 | 0 | 1 | 0 |
| solution-pusher | 1 | 1 | 0 | 0 | 0 | 1 |

## Was the grading accurate?

**Check 1: independent evidence** (`node tools/auditgrades.mjs out/live2`). The graders' final verdict per question against the tagger's labels and simple text checks, on ten questions. They agree 77 to 97 percent of the time (overall 87 percent). Of the 39 disagreements I read the RA lines behind each one:

| Question | Disagreements | Who was right |
|---|---|---|
| Q2 ground rules (7) | graders said NO, signal said YES | **Graders, all 7.** The "ground rules" were orders ("stick to the two-night limit, non-negotiable") or praise containing "respectful". |
| Q4, Q5 reflect each resident (12) | graders NO, signal YES | **Graders in most.** Generic "it sounds like there's frustration on both sides" does not restate what each person said, and side-taking praise is not reflecting. One debatable: "Jordan, I hear that you're feeling like you're the only one making compromises" restates Jordan's feeling; 2 of 3 graders said NO. |
| Q6 acknowledge a feeling (5) | graders NO, signal YES | **Mixed.** For the side-taking RA, "It sounds like Alex is really struggling with this situation, and I can totally see why" does acknowledge a feeling, and graders said NO (0 or 1 vote). They seem to mark a biased RA down on this question too. |
| Q14 specific agreement (5) | 3 graders YES, 2 NO | **Graders.** They quoted exact who/what/when lines ("Sunday through Thursday are no-guest nights..."); the signal wanted a check-in too. For the side-taker orders ("Alex, stick to earplugs after 10:30"), NO is right: an order is not an agreement the roommates stated. |
| Q15 follow-up (4) | graders YES, signal NO | **Graders.** "If anything comes up, feel free to reach out for support" is offering further support, which the question counts. |
| Q1, Q8, Q9 (4) | graders NO, signal YES | **Graders for Q1 and Q9** (no opening statement of purpose; orders are lecturing). **Borderline for Q8**: a solution-pusher gave orders to both residents without saying who was at fault; the avoid questions need a quoted line showing good behaviour, which orders do not give. |
| Q10 open questions (2) | one each way | Noise both ways (see check 2). |

**Check 2: I graded four full sessions myself**, question by question, reading every RA message (strong/noise, average/hygiene, side-taker/noise, plus the Q10 cases from average/cleaning and rushed-good/cleaning). On the three complete sessions I agreed with the graders on **41 of 45** verdicts (91 percent). The differences, all borderline:
- **Q3** (invite each resident in turn to describe their experience before ideas) twice: graders gave NO (0 and 1 votes) where I read YES. Strong RAs got Q3 in 5 of 6 sessions, so this is occasional strictness, not a pattern.
- **Q11** (waiting for solutions): graders NO, I read it as borderline YES.
- **Q5** in the side-taker session (above).
- **Q10**: average/cleaning got NO (1 vote) although "How's the semester treating you?" and "how do you feel about tackling the cleaning?" are open; rushed-good/cleaning got YES (2 votes) with no open question I could find ("How about focusing on a quick reset..." is a proposal).

## Conclusion

- The grading is accurate enough to trust for practice feedback: in the cases I read, the graders were right more often than the cross-checks, and no grade was wildly wrong. Strong, medium and weak RAs land far apart in every scenario.
- Where graders err, it is by being strict on borderline cases (Q3, Q6 for a biased RA, Q10 in both directions), usually with 1 of 3 votes, so the 2-of-3 rule absorbs most of it.
- **No grading change was made.** The evidence for each possible change (Q6 for a side-taking RA, Q3) is a handful of borderline calls, and the prompt is versioned (rubric v4): a change should come with a larger hand-scored set. The 15 questions and `verifyEvidence` are unchanged.
- To make this checkable properly, hand-score about 20 sessions (`labeled/grader/` and `tools/classifybench.mjs --task grader` are ready for it).

## Simulation notes

- The simulated RA sometimes repeats the same message twice in a row (rushed-good, guest policy). That is the simulated RA, not the graders.
- The strong persona is told to ask "what did you hear the other say" (Q7) but the simulated RA skipped it in 3 of 6 sessions, so Q7 at 50 percent is correct.

import { test } from "node:test";
import assert from "node:assert/strict";
import { resolutionState, proposalStanding, updateOpenness, startingOpenness, mediationPrompt, parseTags, buildTaggerPrompt } from "../public/logic.js";
import { getProfiles, NEEDS, createSession } from "../public/config.js";
import { validateTranscript } from "../liveTranscript.mjs";
import { buildLiveRecord, newLiveLog } from "../public/liveRecord.js";
import { resolutionByPersona } from "../tools/report.mjs";

// ---- helpers ----
const NO_RES = { proposal_on_table: false, plan_has_specifics: false, meets_needs: { alex: false, jordan: false } };
const tag = (o = {}) => ({ addresses: "both", reflective_listening: false, validates_feeling: false, open_question: false, invites_to_share: false, ground_rules: false, proposes_solution: false, takes_side: false, lectures: false, ...NO_RES, ...o });
// A plan on the table that keeps both residents' must-haves.
const PLAN = (o = {}) => tag({ proposal_on_table: true, meets_needs: { alex: true, jordan: true }, ...o });
const ALEX_YES = { sender: "Alex", text: "That works for me. I'll be quiet by 10:30 starting tonight." };
const JORDAN_YES = { sender: "Jordan", text: "That works for me. My study group will use the lounge on Tuesdays starting next week." };
const ALEX_NO = { sender: "Alex", text: "I still don't know about this." };
const JORDAN_NO = { sender: "Jordan", text: "Why does it always have to be my schedule?" };
const intros = [{ sender: "Alex", text: "Hi, I'm Alex." }, { sender: "Jordan", text: "Hi, I'm Jordan." }];
// turns: [{ ra, replies }]. Returns the history in app order.
const hist = turns => [...intros, ...turns.flatMap(t => [{ sender: "Sam", text: t.ra }, ...t.replies])];
const OPEN = { alex: 2, jordan: 2 };

// ---- resolutionState ----

test("exploring: no tags yet, or no proposal on the table", () => {
  assert.equal(resolutionState(intros, [], OPEN), "exploring");
  const h = hist([{ ra: "Tell me more.", replies: [ALEX_NO] }]);
  assert.equal(resolutionState(h, [tag()], OPEN), "exploring");
});

test("proposal_pending: a plan is on the table and nobody has accepted", () => {
  const h = hist([{ ra: "What if quiet starts at 10:30?", replies: [ALEX_NO, JORDAN_NO] }]);
  assert.equal(resolutionState(h, [PLAN()], OPEN), "proposal_pending");
});

test("accepted_by_one: one resident accepts, the other has not", () => {
  const h = hist([{ ra: "What if quiet starts at 10:30?", replies: [ALEX_YES, JORDAN_NO] }]);
  assert.equal(resolutionState(h, [PLAN()], OPEN), "accepted_by_one");
});

test("both accepted but no what, when and check-in yet stays proposal_pending", () => {
  const h = hist([{ ra: "What if quiet starts at 10:30?", replies: [ALEX_YES, JORDAN_YES] }]);
  assert.equal(resolutionState(h, [PLAN()], OPEN), "proposal_pending");
});

test("resolved: both accepted, openness earned, plan has specifics", () => {
  const h = hist([{ ra: "So quiet by 10:30, study group in the lounge Tuesdays, check in next Friday?", replies: [ALEX_YES, JORDAN_YES] }]);
  assert.equal(resolutionState(h, [PLAN({ plan_has_specifics: true })], OPEN), "resolved");
});

test("an acceptance does not count when that resident has no trust (openness 0)", () => {
  const h = hist([{ ra: "Quiet by 10:30, check in Friday?", replies: [ALEX_YES, JORDAN_YES] }]);
  const tags = [PLAN({ plan_has_specifics: true })];
  assert.equal(resolutionState(h, tags, { alex: 1, jordan: 0 }), "accepted_by_one");
  assert.equal(resolutionState(h, tags, { alex: 0, jordan: 0 }), "proposal_pending");
  assert.equal(resolutionState(h, tags, { alex: 1, jordan: 1 }), "resolved"); // some trust is enough
});

test("an acceptance does not count when the plan fails that resident's must-haves", () => {
  const h = hist([{ ra: "Quiet by 10:30, check in Friday?", replies: [ALEX_YES, JORDAN_YES] }]);
  const tags = [PLAN({ plan_has_specifics: true, meets_needs: { alex: true, jordan: false } })];
  assert.equal(resolutionState(h, tags, OPEN), "accepted_by_one");
});

test("a later reply that is not an acceptance cancels that resident's acceptance", () => {
  const h = hist([
    { ra: "Quiet by 10:30, check in Friday?", replies: [ALEX_YES, JORDAN_YES] },
    { ra: "Jordan, is that really okay?", replies: [JORDAN_NO] },
  ]);
  const tags = [PLAN({ plan_has_specifics: true }), PLAN()];
  assert.equal(resolutionState(h, tags, OPEN), "accepted_by_one");
});

test("if the latest RA message no longer has a plan on the table, it is exploring again", () => {
  const h = hist([
    { ra: "Quiet by 10:30, check in Friday?", replies: [ALEX_YES, JORDAN_YES] },
    { ra: "Actually, let's step back. How are you each feeling?", replies: [ALEX_NO] },
  ]);
  assert.equal(resolutionState(h, [PLAN({ plan_has_specifics: true }), tag()], OPEN), "exploring");
});

test("a null tag (tagger failed) never throws and never resolves", () => {
  const h = hist([{ ra: "Quiet by 10:30?", replies: [ALEX_YES, JORDAN_YES] }]);
  assert.equal(resolutionState(h, [null], OPEN), "exploring");
  assert.equal(resolutionState(h, [PLAN(), null], OPEN), "exploring");
});

// ---- proposalStanding ----

test("standing counts a resident's replies while a plan that keeps their must-haves stays on the table", () => {
  const h = hist([
    { ra: "What if quiet starts at 10:30?", replies: [ALEX_NO] },
    { ra: "Does that work for both of you?", replies: [ALEX_NO, JORDAN_NO] },
  ]);
  assert.deepEqual(proposalStanding(h, [PLAN(), PLAN()]), { alex: 2, jordan: 1 });
});

test("standing resets after a turn without the plan, ignores intros, and is zero if the latest RA message dropped it", () => {
  const h = hist([
    { ra: "What if quiet starts at 10:30?", replies: [ALEX_NO] },
    { ra: "Tell me more about the study group.", replies: [ALEX_NO] },
    { ra: "What if quiet starts at 10:30?", replies: [ALEX_NO] },
  ]);
  assert.deepEqual(proposalStanding(h, [PLAN(), tag(), PLAN()]), { alex: 1, jordan: 0 });
  assert.deepEqual(proposalStanding(h, [PLAN(), PLAN(), tag()]), { alex: 0, jordan: 0 });
  assert.deepEqual(proposalStanding(intros, []), { alex: 0, jordan: 0 });
});

test("standing counts only the resident whose must-haves the plan keeps", () => {
  const h = hist([{ ra: "What if quiet starts at 10:30?", replies: [ALEX_NO, JORDAN_NO] }]);
  assert.deepEqual(proposalStanding(h, [PLAN({ meets_needs: { alex: true, jordan: false } })]), { alex: 1, jordan: 0 });
});

// ---- whole sequences: openness comes from updateOpenness, as in the app ----
function run(turns, tags, difficulty = "medium") {
  let openness = startingOpenness(difficulty);
  const states = [];
  const opennessLog = [];
  for (let i = 0; i < turns.length; i++) {
    openness = updateOpenness(openness, tags[i], difficulty);
    opennessLog.push({ alex: openness.alex, jordan: openness.jordan });
    states.push(resolutionState(hist(turns.slice(0, i + 1)), tags.slice(0, i + 1), openness));
  }
  return { states, opennessLog };
}

test("hostile sequence: residents say yes but a hostile, side-taking, lecturing RA never resolves", () => {
  const turns = [
    { ra: "Wow, quiet hours. How tragic.", replies: [ALEX_NO] },
    { ra: "Alex is right, Jordan, you just need to grow up.", replies: [JORDAN_NO] },
    { ra: "What if we do quiet by 10:30. Do it. Check in Friday.", replies: [ALEX_YES, JORDAN_YES] },
    { ra: "Jordan, you should know better. Quiet by 10:30, check in Friday.", replies: [ALEX_YES, JORDAN_YES] },
    { ra: "Quiet by 10:30, check in Friday. Agree or I report you.", replies: [ALEX_YES, JORDAN_YES] },
  ];
  const tags = [
    tag({ addresses: "none" }),
    tag({ addresses: "jordan", takes_side: true, lectures: true }),
    PLAN({ proposes_solution: true, lectures: true, plan_has_specifics: true }),
    PLAN({ addresses: "jordan", lectures: true, takes_side: true, plan_has_specifics: true }),
    PLAN({ lectures: true, proposes_solution: true, plan_has_specifics: true }),
  ];
  const { states, opennessLog } = run(turns, tags);
  assert.ok(states.every(s => s !== "resolved"), states.join(","));
  assert.ok(opennessLog.every(o => o.alex < 2 && o.jordan < 2), JSON.stringify(opennessLog));
});

test("good sequence: listening raises openness and the plan resolves on the turn it is accepted with specifics", () => {
  const turns = [
    { ra: "Alex, it sounds like you are exhausted. Jordan, it sounds like you feel blamed.", replies: [ALEX_NO, JORDAN_NO] },
    { ra: "Alex, I hear that mornings are hard. Jordan, I hear your evenings matter.", replies: [ALEX_NO, JORDAN_NO] },
    { ra: "What if quiet starts at 10:30 and the study group moves to the lounge on Tuesdays?", replies: [ALEX_NO, JORDAN_NO] },
    { ra: "So quiet by 10:30, study group in the lounge Tuesdays, check in next Friday. Does that work?", replies: [ALEX_YES, JORDAN_YES] },
  ];
  const tags = [
    tag({ reflective_listening: true, validates_feeling: true }),
    tag({ reflective_listening: true, validates_feeling: true }),
    PLAN({ open_question: true }),
    PLAN({ plan_has_specifics: true }),
  ];
  const { states, opennessLog } = run(turns, tags);
  assert.deepEqual(opennessLog[1], { alex: 2, jordan: 2 });
  assert.deepEqual(states, ["exploring", "exploring", "proposal_pending", "resolved"]);
});

// ---- mediationPrompt ----
const profiles = getProfiles("noise", "medium");

test("prompt shows the speaker's must-haves and flexible items, and not the other resident's", () => {
  const p = mediationPrompt("noise", "medium", [], "Alex", 1, profiles, 2);
  for (const m of profiles.alex.mustHaves) assert.ok(p.includes(m), m);
  for (const f of profiles.alex.flexible) assert.ok(p.includes(f), f);
  for (const m of profiles.jordan.mustHaves) assert.ok(!p.includes(m), m);
  assert.match(p, /Never agree to a plan that breaks a must-have/);
});

test("after one turn with a fitting plan and openness 2 or more, the resident must accept or name ONE must-have", () => {
  for (const level of [2, 3]) for (const standing of [1, 2]) {
    const p = mediationPrompt("noise", "medium", [], "Jordan", 5, profiles, level, "RA", standing);
    assert.match(p, /must now either accept it or name ONE specific must-have it fails/);
    assert.match(p, /Do not repeat an objection you already made/);
    assert.match(p, /start with "That works for me\."/);
  }
});

test("on the first reaction to a fitting plan the resident accepts it or names one must-have; at openness 0 the resident is not ready", () => {
  const first = mediationPrompt("noise", "medium", [], "Jordan", 5, profiles, 2, "RA", 0);
  assert.doesNotMatch(first, /must now either accept/);
  assert.match(first, /accept it now, once you feel heard/);
  assert.match(first, /name that ONE must-have and nothing else/);
  assert.match(first, /start with "That works for me\."/);
  const closed = mediationPrompt("noise", "medium", [], "Jordan", 5, profiles, 0, "RA", 5);
  assert.doesNotMatch(closed, /must now either accept/);
  assert.doesNotMatch(closed, /That works for me/);
  assert.match(closed, /not ready to accept any plan yet/);
});

test("a hostile RA is covered in the prompt, and no vague willingness-to-agree wording remains", () => {
  const p = mediationPrompt("noise", "medium", [], "Alex", 9, profiles, 3, "RA", 0);
  assert.match(p, /scolds you, takes a side, orders you around or mocks you, get more guarded/);
  assert.ok(!/willing(ness)? to agree|MUST show willingness|Do not resist anymore/i.test(p));
});

test("a profile with no must-haves gets no needs block", () => {
  const bare = { alex: { name: "Alex", meta: "m", trait: "t", mood: "x", stance: "s" }, jordan: { name: "Jordan", meta: "m", trait: "t", mood: "x", stance: "s" } };
  assert.doesNotMatch(mediationPrompt("noise", "medium", [], "Alex", 1, bare, 2, "RA", 3), /WHAT YOU NEED/);
});

// ---- config data ----
test("every topic gives each resident exactly two must-haves and two flexible items, with no em dashes", () => {
  assert.deepEqual(Object.keys(NEEDS).sort(), ["cleaning", "guest policy", "hygiene", "noise", "religious practice", "shared items"]);
  for (const [topic, n] of Object.entries(NEEDS)) for (const r of ["alex", "jordan"]) {
    for (const k of ["mustHaves", "flexible"]) {
      assert.equal(n[r][k].length, 2, `${topic} ${r} ${k}`);
      for (const t of n[r][k]) { assert.ok(t.trim().length > 10); assert.ok(!t.includes("—"), t); }
    }
  }
  assert.deepEqual(getProfiles("noise", "easy").jordan.mustHaves, NEEDS.noise.jordan.mustHaves);
  assert.equal(getProfiles("unknown topic", "easy").alex.mustHaves.length, 2);
});

test("a new session starts unresolved", () => {
  assert.equal(createSession().resolved, false);
  assert.equal(createSession().resolvedTurn, null);
});

// ---- tagger ----
test("parseTags reads the resolution fields, defaults them to false, and ignores meets_needs without a proposal", () => {
  const base = { addresses: "both", reflective_listening: false, validates_feeling: false, open_question: false, invites_to_share: false, ground_rules: false, proposes_solution: false, takes_side: false, lectures: false };
  const full = parseTags(JSON.stringify({ ...base, proposal_on_table: true, plan_has_specifics: true, meets_needs: { alex: true, jordan: false } }));
  assert.deepEqual([full.proposal_on_table, full.plan_has_specifics, full.meets_needs], [true, true, { alex: true, jordan: false }]);
  const old = parseTags(JSON.stringify(base));
  assert.deepEqual([old.proposal_on_table, old.plan_has_specifics, old.meets_needs], [false, false, { alex: false, jordan: false }]);
  const loose = parseTags(JSON.stringify({ ...base, proposal_on_table: false, meets_needs: { alex: true, jordan: true } }));
  assert.deepEqual(loose.meets_needs, { alex: false, jordan: false });
  const junk = parseTags(JSON.stringify({ ...base, proposal_on_table: "yes", meets_needs: "both" }));
  assert.deepEqual([junk.proposal_on_table, junk.meets_needs], [false, { alex: false, jordan: false }]);
});

test("tagger prompt lists each resident's must-haves only when profiles are given, and asks for the new fields", () => {
  const withNeeds = buildTaggerPrompt([], "What if quiet starts at 10:30?", profiles);
  for (const m of [...profiles.alex.mustHaves, ...profiles.jordan.mustHaves]) assert.ok(withNeeds.includes(m), m);
  for (const f of ["proposal_on_table", "plan_has_specifics", "meets_needs"]) assert.ok(withNeeds.includes(f), f);
  assert.ok(!buildTaggerPrompt([], "hi").includes("must-haves)"));
  assert.ok(!withNeeds.includes("—"));
});

// ---- saving ----
test("the saved live record carries resolved and the turn", () => {
  const session = { ...createSession(), raName: "Sam", resolved: true, resolvedTurn: 4, turnHistory: intros };
  const rec = buildLiveRecord({ session, live: newLiveLog(), models: {}, rubricVersion: 2 });
  assert.equal(rec.resolved, true);
  assert.equal(rec.resolvedTurn, 4);
  const open = buildLiveRecord({ session: { ...session, resolved: false, resolvedTurn: null }, live: newLiveLog(), models: {}, rubricVersion: 2 });
  assert.deepEqual([open.resolved, open.resolvedTurn], [false, null]);
});

test("the server keeps resolved only as a real boolean and the turn only as a small whole number", () => {
  const base = { scenario: "noise", difficulty: "medium", transcript: [{ sender: "Alex", text: "Hi" }] };
  const ok = validateTranscript(JSON.stringify({ ...base, resolved: true, resolvedTurn: 5 })).record;
  assert.deepEqual([ok.resolved, ok.resolvedTurn], [true, 5]);
  const bad = validateTranscript(JSON.stringify({ ...base, resolved: "yes", resolvedTurn: "5; drop table" })).record;
  assert.deepEqual([bad.resolved, bad.resolvedTurn], [false, null]);
  const none = validateTranscript(JSON.stringify(base)).record;
  assert.deepEqual([none.resolved, none.resolvedTurn], [false, null]);
  const huge = validateTranscript(JSON.stringify({ ...base, resolved: true, resolvedTurn: 99999 })).record;
  assert.equal(huge.resolvedTurn, null);
});

// ---- report ----
test("report: plans reached by persona, skipping records saved before resolution existed", () => {
  const recs = [
    { persona: { id: "strong" }, resolved: true, resolvedTurn: 6 },
    { persona: { id: "strong" }, resolved: true, resolvedTurn: 8 },
    { persona: { id: "strong" }, resolved: false, resolvedTurn: null },
    { persona: { id: "hostile" }, resolved: false, resolvedTurn: null },
    { persona: { id: "average" } },
  ];
  const r = resolutionByPersona(recs, ["strong", "hostile", "average"]);
  assert.deepEqual(r.map(x => [x.persona, x.n, x.resolved, x.meanTurn]), [["strong", 3, 2, 7], ["hostile", 1, 0, null]]);
});

import { isConfirmation } from "../public/logic.js";
test("isConfirmation: 'that plan works for me' counts, a hedged or questioning or vague reply does not", () => {
  assert.equal(isConfirmation("Sam, that plan works for me. Lights out by 10:30 on weeknights and I'll keep to it."), true);
  assert.equal(isConfirmation("That works for me. I'll have the study group in the lounge until 11:30 on Tuesdays and Thursdays."), true);
  assert.equal(isConfirmation("That plan works for me, but only if the group moves to the lounge on Tuesdays."), false); // hedge
  assert.equal(isConfirmation("Does that plan work for me? I think so."), false);
  assert.equal(isConfirmation("Sure, that works for me."), false); // nothing concrete
  assert.equal(isConfirmation("The plan sounds fine, I guess."), false);
});

test("isConfirmation: other plain acceptances count, and a question after an acceptance does not void it", () => {
  assert.equal(isConfirmation("Sam, I can live with that. The group keeps the room until 11:30 on Tuesdays and Thursdays."), true);
  assert.equal(isConfirmation("I'm fine with the plan. Lights out by 10:30 on weeknights and I'll keep to it."), true);
  assert.equal(isConfirmation("That works for me. I'll keep the room quiet by 10:30 on weeknights. Sam, can you check in next Friday?"), true);
  // Still not acceptances.
  assert.equal(isConfirmation("Does that work for me? Can you check in next Friday?"), false);
  assert.equal(isConfirmation("I can live with that, but only if the group moves to the lounge on Tuesdays."), false); // hedge
  assert.equal(isConfirmation("I can live with that."), false); // nothing concrete
  assert.equal(isConfirmation("I agree with Jordan's point about Tuesdays."), false); // not about the plan
});

test("an earlier acceptance survives a neutral reply and a vague wrap-up the tagger could not verify", () => {
  const h = hist([
    { ra: "Quiet by 10:30, study group in the lounge on Tuesdays and Thursdays, check in Friday. Do you both agree?", replies: [ALEX_YES, JORDAN_YES] },
    { ra: "Great, sounds like we are on the same page. Thanks both.", replies: [{ sender: "Alex", text: "Thanks Sam, see you Friday." }, { sender: "Jordan", text: "Thanks. See you at the check-in." }] },
  ]);
  // The wrap-up is tagged as not meeting needs, but it does not restate the plan (no specifics), so it is not trusted.
  const tags = [PLAN({ plan_has_specifics: true }), PLAN({ meets_needs: { alex: false, jordan: false } })];
  assert.equal(resolutionState(h, tags, OPEN), "resolved");
});

test("a plan that is restated and now breaks a must-have takes back that resident's acceptance", () => {
  const h = hist([
    { ra: "Quiet by 10:30, study group in the lounge Tuesdays and Thursdays, check in Friday.", replies: [ALEX_YES, JORDAN_YES] },
    { ra: "Final plan: the study group ends at 10:30 in the lounge, check in Friday.", replies: [{ sender: "Alex", text: "Thanks Sam, see you Friday." }, { sender: "Jordan", text: "Okay, see you Friday." }] },
  ]);
  const tags = [PLAN({ plan_has_specifics: true }), PLAN({ plan_has_specifics: true, meets_needs: { alex: true, jordan: false } })];
  assert.equal(resolutionState(h, tags, OPEN), "accepted_by_one");
});

test("a later question or hedge from a resident who had accepted takes the acceptance back; a failed tagger message is skipped", () => {
  const h = hist([
    { ra: "Quiet by 10:30, check in Friday?", replies: [ALEX_YES, JORDAN_YES] },
    { ra: "Anything else?", replies: [{ sender: "Alex", text: "Can we change the check-in to Monday?" }, { sender: "Jordan", text: "No, I'm good." }] },
  ]);
  assert.equal(resolutionState(h, [PLAN({ plan_has_specifics: true }), PLAN()], OPEN), "accepted_by_one");
  assert.equal(resolutionState(h, [PLAN({ plan_has_specifics: true }), null], OPEN), "exploring"); // last tag failed
});

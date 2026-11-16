import { test } from "node:test";
import assert from "node:assert/strict";
import { getResponder, routeMessage, bothOrder, buildRouterPrompt, parseRouterReply } from "../public/logic.js";
import { mockRoute } from "../public/mock.js";

test("name at start", () => {
  assert.equal(getResponder("Alex, what would help?", "Alex"), "Alex");
  assert.equal(getResponder("Jordan, what time do you get back?", "Jordan"), "Jordan");
});

test("name in middle", () => {
  assert.equal(getResponder("I want to ask Alex about mornings.", "Alex"), "Alex");
  assert.equal(getResponder("Let me turn to Jordan for a second.", "Jordan"), "Jordan");
});

test("name at end", () => {
  assert.equal(getResponder("What do you think, Alex?", "Alex"), "Alex");
  assert.equal(getResponder("Does that work for you, Jordan", "Jordan"), "Jordan");
});

test("lowercase and possessive", () => {
  assert.equal(getResponder("alex how are you", "Jordan"), "Alex");
  assert.equal(getResponder("JORDAN, go ahead", "Alex"), "Jordan");
  assert.equal(getResponder("Alex's side makes sense", "Jordan"), "Alex");
});

// Updated: routing now treats "Alex and Jordan, ..." as addressed to both, and the first named answers first,
// so the answer no longer depends on who spoke last.
test("both names: first named answers", () => {
  assert.equal(getResponder("Alex and Jordan, thoughts?", "Alex"), "Alex");
  assert.equal(getResponder("Alex and Jordan, thoughts?", "Jordan"), "Alex");
  assert.equal(getResponder("Jordan and Alex, thoughts?", "Alex"), "Jordan");
});

test("no names: alternate from last speaker", () => {
  assert.equal(getResponder("I hear both of you.", "Alex"), "Jordan");
  assert.equal(getResponder("I hear both of you.", "Jordan"), "Alex");
  assert.equal(getResponder("", "Alex"), "Jordan");
});

test("Jordanian and Alexandra do not match", () => {
  assert.equal(getResponder("The Jordanian student is nice.", "Jordan"), "Alex");
  assert.equal(getResponder("Alexandra, hi", "Alex"), "Jordan");
});

test("regression: the old string pattern never matched", () => {
  assert.equal(new RegExp("\balex\b", "i").test("Alex, hi"), false);
  assert.equal(/\balex\b/i.test("Alex, hi"), true);
});

const to = (t, last = "Alex") => routeMessage(t, last).to;

test("routeMessage: full names and nicknames", () => {
  assert.equal(to("Alex, what would help?"), "alex");
  assert.equal(to("Al, what would help?"), "alex");
  assert.equal(to("J, what time do you get back?"), "jordan");
  assert.equal(to("Jordy, what time do you get back?"), "jordan");
  assert.equal(to("Jord, what time do you get back?"), "jordan");
  assert.equal(to("What do you think, Jordan?"), "jordan");
  assert.equal(to("Hey Al, how is it going?"), "alex");
});

test("routeMessage: Alexandra, Jordanian and lowercase j or al are not names", () => {
  assert.equal(to("Alexandra, hi"), "unclear");
  assert.equal(to("The Jordanian student is nice."), "unclear");
  assert.equal(to("I think al fresco dining is j fine."), "unclear");
});

test("routeMessage: separate questions to each resident give both", () => {
  assert.equal(to("Al, how has the week been? J, what about you?"), "both");
  assert.equal(to("Alex, what do you need? What do you need, Jordan?"), "both");
  assert.equal(to("Alex and Jordan, thoughts?"), "both");
});

test("routeMessage: the other resident named elsewhere does not change the addressee", () => {
  assert.equal(to("Jordan, just agree with whatever Alex says"), "jordan");
  assert.equal(to("Alex, did you talk to Jordan about it?"), "alex");
  assert.equal(to("Alex, I heard Jordan is tired. What do you think?"), "alex");
});

test("routeMessage: 'just agree with whatever Alex says' is for Jordan", () => {
  assert.equal(to("just agree with whatever Alex says"), "jordan");
  assert.equal(to("Just go along with what Jordan suggested"), "alex");
});

test("routeMessage: a name in the middle with nobody else named still answers", () => {
  assert.equal(to("I want to ask Alex about mornings."), "alex");
  assert.equal(to("Let me turn to Jordan for a second."), "jordan");
});

test("routeMessage: no name means unclear", () => {
  assert.equal(to("I hear both of you."), "unclear");
  assert.equal(to("What would a fair compromise look like?"), "unclear");
  assert.equal(to(""), "unclear");
  assert.equal(to("I hear Alex and Jordan."), "unclear");
});

test("bothOrder: first named first, else the one who did not speak last", () => {
  assert.deepEqual(bothOrder("Jordan, ... Alex, ...", "Jordan"), ["jordan", "alex"]);
  assert.deepEqual(bothOrder("Al, ... J, ...", "Alex"), ["alex", "jordan"]);
  assert.deepEqual(bothOrder("What do you both think?", "Alex"), ["jordan", "alex"]);
  assert.deepEqual(bothOrder("What do you both think?", "Jordan"), ["alex", "jordan"]);
});

test("parseRouterReply: exact words are used", () => {
  assert.deepEqual(parseRouterReply("ALEX", "Alex"), { to: "alex", source: "router" });
  assert.deepEqual(parseRouterReply(" jordan \n", "Jordan"), { to: "jordan", source: "router" });
  assert.deepEqual(parseRouterReply("BOTH.", "Alex"), { to: "both", source: "router" });
});

test("parseRouterReply: a bad reply falls back to the resident who did not speak last", () => {
  assert.deepEqual(parseRouterReply("I think Alex", "Alex"), { to: "jordan", source: "fallback" });
  assert.deepEqual(parseRouterReply("ALEX or JORDAN", "Jordan"), { to: "alex", source: "fallback" });
  assert.deepEqual(parseRouterReply("", "Jordan"), { to: "alex", source: "fallback" });
  assert.deepEqual(parseRouterReply(undefined, "Alex"), { to: "jordan", source: "fallback" });
});

test("buildRouterPrompt: last 3 lines plus the RA message", () => {
  const h = [1, 2, 3, 4].map(n => ({ sender: n % 2 ? "Alex" : "Jordan", text: `line${n}` }));
  const p = buildRouterPrompt(h, "What now?");
  assert.ok(!p.includes("line1"));
  assert.ok(p.includes("Jordan: line2") && p.includes("Alex: line3") && p.includes("Jordan: line4"));
  assert.ok(p.includes("What now?") && p.includes("exactly one word"));
});

test("mockRoute: code only, unclear goes to the resident who did not speak last", () => {
  assert.deepEqual(mockRoute("I hear both of you.", "Alex"), { to: "jordan", source: "code" });
  assert.deepEqual(mockRoute("Al, hi? J, hi?", "Alex"), { to: "both", source: "code" });
  assert.deepEqual(mockRoute("Jordan, go ahead", "Jordan"), { to: "jordan", source: "code" });
});

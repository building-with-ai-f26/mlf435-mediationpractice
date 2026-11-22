// Text for the "User Evidence" box on docs/index.html, from docs/analytics.json. Pure, so tests can import it.
export const NOT_MEASURED = "Not yet measured";

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// data: the parsed analytics.json (or anything else). Returns the sentence, or "Not yet measured".
export function formatEvidence(data) {
  const live = data && data.live;
  if (!live || !Number.isFinite(live.sessions) || live.sessions <= 0) return NOT_MEASURED;
  const parts = [`${plural(live.sessions, "live session", "live sessions")}`, `${Number.isFinite(live.debriefs) ? live.debriefs : 0} finished a debrief`];
  if (Number.isFinite(live.avgMet)) parts.push(`average ${live.avgMet} of 15 on the rubric`);
  const date = typeof data.generated === "string" && /^\d{4}-\d{2}-\d{2}$/.test(data.generated) ? data.generated : null;
  return parts.join(", ") + (date ? `, as of ${date}` : "");
}

// Browser only: fills the box. Any failure leaves the default text in place.
export async function fillEvidence(el, url = "analytics.json") {
  try {
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) return;
    el.textContent = formatEvidence(await res.json());
  } catch (e) { /* missing or unreadable file: keep "Not yet measured" */ }
}

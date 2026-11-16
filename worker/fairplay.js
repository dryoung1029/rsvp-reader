// Fair-play rules shared by stats, quizzes and the game. The Help page
// describes these in general terms on purpose; the numbers live here.

export const DAILY_COUNTED_CAP = 60000;      // game-counted words per person per day
export const STREAK_DAY_MIN_WORDS = 300;     // counted words that make a day count for streaks
export const GOAL_MIN_FOR_ACHIEVEMENT = 1000;
export const FINISH_COVERAGE = 0.8;          // share of a document that must have counted
export const QUIZ_SECONDS = 90;              // time to answer all three questions
export const QUIZ_GRACE_MS = 15000;          // network slack on top of the timer
export const MIN_DIVERSITY = 0.45;           // moving-average type/token ratio, 100-word window
export const SEND_MIN_WORDS = 300;           // a send counts after the recipient reads this much of it
export const MAX_DAYS_BACK = 1;              // reading must be logged today or yesterday (local)

export function flag(env, userId, kind, detail = "") {
  return env.DB.prepare("INSERT INTO fair_play_flags (user_id, kind, detail, created_at) VALUES (?, ?, ?, ?)")
    .bind(userId, kind, String(detail).slice(0, 300), Date.now());
}

// ---------- Word ranges ----------

export function mergeRanges(ranges) {
  const sorted = ranges.filter(([a, b]) => b >= a).sort((x, y) => x[0] - y[0]);
  const out = [];
  for (const [a, b] of sorted) {
    const last = out[out.length - 1];
    if (last && a <= last[1] + 1) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

export function rangeLength(ranges) {
  return ranges.reduce((n, [a, b]) => n + (b - a + 1), 0);
}

// How many words of [a, b] are not already in `covered`.
export function newWordsIn([a, b], covered) {
  let overlap = 0;
  for (const [c, d] of covered) {
    const lo = Math.max(a, c), hi = Math.min(b, d);
    if (hi >= lo) overlap += hi - lo + 1;
  }
  return Math.max(0, b - a + 1 - overlap);
}

// ---------- Text checks ----------

// Moving-average type/token ratio: ordinary prose scores around 0.65-0.8,
// text that repeats a handful of words scores far lower.
export function diversity(words) {
  const toks = words.map((w) => w.toLowerCase().replace(/[^a-z0-9']/g, "")).filter(Boolean);
  const win = 100;
  if (toks.length < win) return toks.length ? new Set(toks).size / toks.length : 0;
  const counts = new Map();
  for (let i = 0; i < win; i += 1) counts.set(toks[i], (counts.get(toks[i]) || 0) + 1);
  let total = counts.size;
  let windows = 1;
  const step = Math.max(1, Math.floor((toks.length - win) / 400)); // sample at most ~400 windows
  for (let i = win; i < toks.length; i += 1) {
    const out = toks[i - win], inn = toks[i];
    const c = counts.get(out) - 1;
    if (c) counts.set(out, c); else counts.delete(out);
    counts.set(inn, (counts.get(inn) || 0) + 1);
    if ((i - win) % step === 0) { total += counts.size; windows += 1; }
  }
  return total / windows / win;
}

async function hash(text) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(d).slice(0, 8), (b) => b.toString(16).padStart(2, "0")).join("");
}

// Three samples from different parts of the text, so a copy with a small
// change still matches the original.
export async function fingerprints(words) {
  const n = words.length;
  const norm = (a) => words.slice(a, a + 60).join(" ").toLowerCase().replace(/[^a-z0-9 ]/g, "");
  if (n < 200) return [await hash(norm(0))];
  return Promise.all([0.15, 0.5, 0.85].map((p) => hash(norm(Math.floor(n * p)))));
}

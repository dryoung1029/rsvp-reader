// Reading stats: words read and time spent reading, per person per local day.
import { HttpError, json, readJson } from "./util.js";
import { requireUser } from "./auth.js";
import { evaluate } from "./game.js";
import { pendingSummary } from "./quiz.js";
import { flag, MAX_DAYS_BACK } from "./fairplay.js";

// A device's local calendar day for a server timestamp, given its UTC offset
// (JavaScript's getTimezoneOffset: minutes to add to local time to get UTC).
function localDate(ms, tzOffset) {
  return new Date(ms - tzOffset * 60000).toISOString().slice(0, 10);
}
function localHour(ms, tzOffset) {
  return new Date(ms - tzOffset * 60000).getUTCHours();
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function shiftDay(day, delta) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

export function todayFrom(request) {
  const day = new URL(request.url).searchParams.get("today") || "";
  return DAY_RE.test(day) ? day : new Date().toISOString().slice(0, 10);
}

// Consecutive days with some reading, ending today (or yesterday, so a streak
// isn't shown as broken before you've had a chance to read today).
export function streakFrom(daysWithReading, today) {
  const set = new Set(daysWithReading);
  let day = set.has(today) ? today : shiftDay(today, -1);
  let streak = 0;
  while (set.has(day)) { streak += 1; day = shiftDay(day, -1); }
  return streak;
}

function wpm(words, ms) {
  return ms > 60000 ? Math.round(words / (ms / 60000)) : 0;
}

async function summaryFor(env, userId, today) {
  const { results } = await env.DB.prepare(
    "SELECT day, words, ms, verified_words FROM reading_days WHERE user_id = ? AND day >= ? AND words > 0 ORDER BY day"
  ).bind(userId, shiftDay(today, -400)).all();
  const totals = await env.DB.prepare("SELECT COALESCE(SUM(words), 0) AS words, COALESCE(SUM(ms), 0) AS ms, COALESCE(SUM(verified_words), 0) AS verified FROM reading_days WHERE user_id = ?").bind(userId).first();
  const byDay = new Map(results.map((r) => [r.day, r]));
  const sumSince = (start) => results.filter((r) => r.day >= start).reduce((a, r) => ({ words: a.words + r.words, ms: a.ms + r.ms, verified: a.verified + r.verified_words }), { words: 0, ms: 0, verified: 0 });
  const week = sumSince(shiftDay(today, -6));
  const month = sumSince(shiftDay(today, -29));
  const days = [];
  for (let i = 13; i >= 0; i -= 1) {
    const day = shiftDay(today, -i);
    const r = byDay.get(day);
    days.push({ day, words: r?.words || 0, ms: r?.ms || 0 });
  }
  let best = 0;
  let run = 0;
  let prev = null;
  for (const r of results) {
    run = prev && shiftDay(prev, 1) === r.day ? run + 1 : 1;
    best = Math.max(best, run);
    prev = r.day;
  }
  return {
    today: { words: byDay.get(today)?.words || 0, ms: byDay.get(today)?.ms || 0, verified: byDay.get(today)?.verified_words || 0 },
    week,
    total: { words: totals.words, ms: totals.ms, verified: totals.verified },
    avgWpm: wpm(month.words, month.ms),
    streak: streakFrom(results.map((r) => r.day), today),
    bestStreak: best,
    days
  };
}

export async function handleStats(request, env, pathname) {
  if (!pathname.startsWith("/api/stats")) return null;
  const user = await requireUser(request, env);
  const method = request.method;

  if (pathname === "/api/stats" && method === "POST") {
    // Increments from one device. Several days may arrive at once after being offline.
    const body = await readJson(request);
    const entries = Array.isArray(body.days) ? body.days.slice(0, 31) : [body];
    const statements = [];
    for (const e of entries) {
      if (!DAY_RE.test(String(e.day || ""))) throw new HttpError(400, "Invalid day.");
      const words = Math.max(0, Math.min(200000, Math.floor(Number(e.words) || 0)));
      const ms = Math.max(0, Math.min(24 * 3600 * 1000, Math.floor(Number(e.ms) || 0)));
      if (!words && !ms) continue;
      statements.push(env.DB.prepare(
        `INSERT INTO reading_days (user_id, day, words, ms) VALUES (?, ?, ?, ?)
         ON CONFLICT (user_id, day) DO UPDATE SET words = words + excluded.words, ms = ms + excluded.ms`
      ).bind(user.id, e.day, words, ms));
    }
    // Sittings (Play until Pause). Only sittings that pass these checks can
    // later count toward the game; everything still counts in personal stats.
    // verified: 0 waiting for a quiz, -2 overlapped another device, -3 failed a check.
    const now = Date.now();
    const sentAt = Number(body.sentAt);
    const skew = Number.isFinite(sentAt) ? now - sentAt : null; // corrects a wrong device clock
    const incoming = [];
    for (const sess of Array.isArray(body.sessions) ? body.sessions.slice(0, 50) : []) {
      if (!DAY_RE.test(String(sess.day || ""))) continue;
      const words = Math.max(0, Math.min(100000, Math.floor(Number(sess.words) || 0)));
      const ms = Math.max(0, Math.min(12 * 3600 * 1000, Math.floor(Number(sess.ms) || 0)));
      const wpm = Math.max(0, Math.min(1000, Math.floor(Number(sess.wpm) || 0)));
      if (words < 20) continue;
      if (ms < (words / Math.max(wpm, 1)) * 60000 * 0.6) continue; // faster than the setting allows
      const docId = /^[0-9a-f-]{36}$/.test(String(sess.docId || "")) ? sess.docId : null;
      const startWord = Number.isFinite(Number(sess.startWord)) ? Math.max(0, Math.floor(sess.startWord)) : null;
      const endWord = Number.isFinite(Number(sess.endWord)) ? Math.max(0, Math.floor(sess.endWord)) : null;
      const tz = Math.max(-900, Math.min(900, Math.floor(Number(sess.tzOffset) || 0)));
      let started = Number(sess.startedAt), ended = Number(sess.endedAt);
      let status = 0;
      const problems = [];
      if (skew == null || !Number.isFinite(started) || !Number.isFinite(ended)) {
        status = -3; problems.push("missing times");
      } else {
        started += skew; ended += skew;
        if (ended > now + 60000 || ended < started) { status = -3; problems.push("impossible times"); }
        if (ended - started < ms * 0.8 - 2000) { status = -3; problems.push("time doesn't add up"); }
        if (localDate(started, tz) !== sess.day && localDate(ended, tz) !== sess.day) { status = -3; problems.push(`day ${sess.day} doesn't match`); }
        const daysBack = (Date.parse(localDate(now, tz)) - Date.parse(sess.day)) / 86400000;
        if (daysBack > MAX_DAYS_BACK) { status = -3; problems.push(`logged ${daysBack} days late`); }
      }
      if (startWord == null || endWord == null || !docId) { status = -3; problems.push("no position"); }
      else if (words > (endWord - startWord + 1) * 1.1 + 10) { status = -3; problems.push(`${words} words for a ${endWord - startWord + 1}-word range`); }
      incoming.push({ sess, words, ms, wpm, docId, startWord, endWord, started, ended, tz, status, problems });
    }

    // Reading on two devices at the same time only counts once.
    const timed = incoming.filter((x) => x.status === 0);
    if (timed.length) {
      const lo = Math.min(...timed.map((x) => x.started)), hi = Math.max(...timed.map((x) => x.ended));
      const { results: existing } = await env.DB.prepare(
        "SELECT started_at, ended_at FROM reading_sessions WHERE user_id = ? AND started_at < ? AND ended_at > ? AND verified IN (0, 1)"
      ).bind(user.id, hi, lo).all();
      const accepted = existing.map((e) => [e.started_at, e.ended_at]);
      for (const x of timed.sort((a, b) => a.started - b.started)) {
        const clash = accepted.some(([a, b]) => Math.min(b, x.ended) - Math.max(a, x.started) > 5000);
        if (clash) { x.status = -2; x.problems.push("overlaps another sitting"); }
        else accepted.push([x.started, x.ended]);
      }
    }

    for (const x of incoming) {
      const hour = x.started ? localHour(x.started, x.tz) : -1;
      statements.push(env.DB.prepare(
        `INSERT INTO reading_sessions (user_id, day, hour, words, ms, wpm, created_at, doc_id, start_word, end_word, verified, started_at, ended_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(user.id, x.sess.day, hour, x.words, x.ms, x.wpm, now, x.docId, x.startWord, x.endWord, x.status, x.started || null, x.ended || null));
      if (x.status === -2) statements.push(flag(env, user.id, "overlap", `${x.words} words while another device was reading`));
      else if (x.status === -3 && !x.problems.includes("missing times")) statements.push(flag(env, user.id, "rejected", `${x.words} words: ${x.problems.join("; ")}`));
    }
    if (statements.length) await env.DB.batch(statements);
    const today = DAY_RE.test(String(body.today || "")) ? body.today : entries[0]?.day;
    const unlocked = statements.length ? await evaluate(env, user.id, today) : [];
    const todayRow = today ? await env.DB.prepare("SELECT words FROM reading_days WHERE user_id = ? AND day = ?").bind(user.id, today).first() : null;
    return json({ ok: true, unlocked, todayWords: todayRow?.words || 0, dailyGoal: user.daily_goal || 0, quiz: await pendingSummary(env, user.id) });
  }

  const today = todayFrom(request);

  if (pathname === "/api/stats" && method === "GET") {
    return json(await summaryFor(env, user.id, today));
  }

  // Family board: only people who chose to appear on it, and only visible to them.
  if (pathname === "/api/stats/family" && method === "GET") {
    if (!user.share_stats) return json({ optedIn: false, members: [] });
    const { results: people } = await env.DB.prepare("SELECT id, name FROM users WHERE share_stats = 1").all();
    const members = [];
    for (const p of people) {
      const s = await summaryFor(env, p.id, today);
      members.push({ id: p.id, name: p.name, isYou: p.id === user.id, weekWords: s.week.words, streak: s.streak, avgWpm: s.avgWpm, todayWords: s.today.words });
    }
    members.sort((a, b) => b.weekWords - a.weekWords);
    return json({ optedIn: true, members });
  }

  throw new HttpError(404, "Not found");
}

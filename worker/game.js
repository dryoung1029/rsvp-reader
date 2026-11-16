// Achievements, levels, monthly competitions and leaderboards.
// Achievements are evaluated on the server from recorded reading, so they
// can't be unlocked by editing the app, and they're kept once earned.
import { ACHIEVEMENTS, ACHIEVEMENTS_BY_ID, SPEED_MIN_DOC_WORDS, xpFor, levelFor } from "../shared/achievements.js";
import { HttpError, json } from "./util.js";
import { requireUser } from "./auth.js";
import { shiftDay, streakFrom, todayFrom } from "./stats.js";
import { STREAK_DAY_MIN_WORDS, GOAL_MIN_FOR_ACHIEVEMENT } from "./fairplay.js";

const MONTH_RE = /^\d{4}-\d{2}$/;

export function utcDay() {
  return new Date().toISOString().slice(0, 10);
}

export function logEvent(env, userId, kind, { value = 0, meta = "", day = utcDay() } = {}) {
  return env.DB.prepare("INSERT INTO user_events (user_id, kind, value, meta, day, at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(userId, kind, Math.floor(value) || 0, String(meta).slice(0, 40), day, Date.now());
}

function bestStreakOf(days) {
  let best = 0;
  let run = 0;
  let prev = null;
  for (const day of days) {
    run = prev && shiftDay(prev, 1) === day ? run + 1 : 1;
    best = Math.max(best, run);
    prev = day;
  }
  return best;
}

// Words read per board member per month, for months before `currentMonth`.
// Returns Map(userId -> { wins, podiums }).
async function pastCompetitionResults(env, currentMonth) {
  const { results } = await env.DB.prepare(
    `SELECT r.user_id, substr(r.day, 1, 7) AS month, SUM(r.verified_words) AS words
     FROM reading_days r JOIN users u ON u.id = r.user_id
     WHERE u.share_stats = 1 AND r.day < ? AND r.verified_words > 0
     GROUP BY r.user_id, month`
  ).bind(`${currentMonth}-01`).all();
  const byMonth = new Map();
  for (const r of results) {
    if (!byMonth.has(r.month)) byMonth.set(r.month, []);
    byMonth.get(r.month).push(r);
  }
  const tally = new Map();
  const bump = (id, key) => {
    const t = tally.get(id) || { wins: 0, podiums: 0, months: [] };
    t[key] += 1;
    tally.set(id, t);
    return t;
  };
  for (const [month, rows] of byMonth) {
    rows.sort((a, b) => b.words - a.words);
    if (rows.length >= 2) bump(rows[0].user_id, "wins").months.push(month);
    if (rows.length >= 3) rows.slice(0, 3).forEach((r) => bump(r.user_id, "podiums"));
  }
  return tally;
}

export async function buildContext(env, userId, today, competition) {
  const [daysRes, sessRes, eventsRes, userRes] = await env.DB.batch([
    env.DB.prepare("SELECT day, verified_words AS words, verified_ms AS ms FROM reading_days WHERE user_id = ? AND verified_words > 0 ORDER BY day").bind(userId),
    env.DB.prepare(
      `SELECT MAX(CASE WHEN counted_words >= 500 AND doc_words >= ${SPEED_MIN_DOC_WORDS} THEN wpm END) AS w500,
              MAX(CASE WHEN counted_words >= 1000 AND doc_words >= ${SPEED_MIN_DOC_WORDS} THEN wpm END) AS w1000,
              MAX(counted_words) AS longest,
              MAX(CASE WHEN hour >= 22 OR hour < 4 THEN 1 ELSE 0 END) AS night,
              MAX(CASE WHEN hour >= 4 AND hour < 7 THEN 1 ELSE 0 END) AS early
       FROM reading_sessions WHERE user_id = ? AND verified = 1`
    ).bind(userId),
    env.DB.prepare(
      `SELECT kind, COUNT(*) AS n, MAX(value) AS maxv, SUM(CASE WHEN meta = 'shared' THEN 1 ELSE 0 END) AS shared,
              COUNT(DISTINCT meta) AS metas, SUM(CASE WHEN kind = 'quiz' AND value = 1 THEN 1 ELSE 0 END) AS firstTry
       FROM user_events WHERE user_id = ? GROUP BY kind`
    ).bind(userId),
    env.DB.prepare("SELECT share_stats, daily_goal FROM users WHERE id = ?").bind(userId)
  ]);
  const days = daysRes.results;
  // A day counts for streaks only with a real amount of counted reading.
  const dayList = days.filter((d) => d.words >= STREAK_DAY_MIN_WORDS).map((d) => d.day);
  const daySet = new Set(dayList);
  const sess = sessRes.results[0] || {};
  const ev = Object.fromEntries(eventsRes.results.map((e) => [e.kind, e]));
  const user = userRes.results[0] || {};
  const comp = competition?.get(userId) || { wins: 0, podiums: 0 };
  // Small goals still work day to day, but don't count toward the goal achievements.
  const goal = (user.daily_goal || 0) >= GOAL_MIN_FOR_ACHIEVEMENT ? user.daily_goal : 0;

  return {
    totalWords: days.reduce((a, d) => a + d.words, 0),
    totalMs: days.reduce((a, d) => a + d.ms, 0),
    daysRead: dayList.length,
    maxDayWords: days.reduce((a, d) => Math.max(a, d.words), 0),
    streak: streakFrom(dayList, today),
    bestStreak: bestStreakOf(dayList),
    weekend: dayList.some((d) => new Date(`${d}T12:00:00Z`).getUTCDay() === 6 && daySet.has(shiftDay(d, 1))),
    dailyGoal: goal,
    goalDays: goal ? days.filter((d) => d.words >= goal).length : 0,
    bestWpm: { 500: sess.w500 || 0, 1000: sess.w1000 || 0 },
    longestSession: sess.longest || 0,
    nightOwl: Boolean(sess.night),
    earlyBird: Boolean(sess.early),
    finished: ev.finished?.n || 0,
    biggestFinished: ev.finished?.maxv || 0,
    finishedShared: ev.finished?.shared || 0,
    sources: ev.import?.metas || 0,
    sent: ev.sent?.n || 0,
    received: ev.received?.n || 0,
    onBoard: Boolean(user.share_stats),
    wins: comp.wins,
    podiums: comp.podiums,
    quizzes: ev.quiz?.n || 0,
    quizzesFirstTry: ev.quiz?.firstTry || 0
  };
}

// Awards anything newly earned, then returns (and marks as shown) every
// achievement this person hasn't been told about yet.
export async function evaluate(env, userId, today = utcDay(), { claim = true } = {}) {
  const competition = await pastCompetitionResults(env, today.slice(0, 7));
  const ctx = await buildContext(env, userId, today, competition);
  const { results } = await env.DB.prepare("SELECT id FROM achievements WHERE user_id = ?").bind(userId).all();
  const have = new Set(results.map((r) => r.id));
  const earned = ACHIEVEMENTS.filter((a) => !have.has(a.id) && a.check(ctx));
  const now = Date.now();
  if (earned.length) {
    await env.DB.batch(earned.map((a) =>
      env.DB.prepare("INSERT OR IGNORE INTO achievements (user_id, id, unlocked_at, seen) VALUES (?, ?, ?, 0)").bind(userId, a.id, now)));
  }
  // claim: false awards without marking them shown, for someone who isn't here
  // right now; they see the pop-ups next time they open RAFAS.
  if (!claim) return [];
  const claimed = await env.DB.prepare("UPDATE achievements SET seen = 1 WHERE user_id = ? AND seen = 0 RETURNING id").bind(userId).all();
  return claimed.results.map((r) => r.id).filter((id) => ACHIEVEMENTS_BY_ID[id]);
}

async function profileFor(env, userId, today, competition) {
  const ctx = await buildContext(env, userId, today, competition);
  const { results } = await env.DB.prepare("SELECT id, unlocked_at FROM achievements WHERE user_id = ?").bind(userId).all();
  const unlocked = results.filter((r) => ACHIEVEMENTS_BY_ID[r.id]);
  const points = unlocked.reduce((sum, r) => sum + ACHIEVEMENTS_BY_ID[r.id].points, 0);
  return { ctx, unlocked, points, level: levelFor(xpFor(ctx.totalWords, points)) };
}

function monthBounds(month) {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start: `${month}-01`, end: `${month}-${String(last).padStart(2, "0")}`, days: last };
}

async function monthStandings(env, month) {
  const { start, end } = monthBounds(month);
  const [words, days, speed, finished, people] = await env.DB.batch([
    env.DB.prepare(
      `SELECT r.user_id, SUM(r.verified_words) AS v FROM reading_days r JOIN users u ON u.id = r.user_id
       WHERE u.share_stats = 1 AND r.day BETWEEN ? AND ? GROUP BY r.user_id HAVING v > 0 ORDER BY v DESC`
    ).bind(start, end),
    env.DB.prepare(
      `SELECT r.user_id, COUNT(*) AS v FROM reading_days r JOIN users u ON u.id = r.user_id
       WHERE u.share_stats = 1 AND r.day BETWEEN ? AND ? AND r.verified_words >= ${STREAK_DAY_MIN_WORDS} GROUP BY r.user_id ORDER BY v DESC`
    ).bind(start, end),
    env.DB.prepare(
      `SELECT s.user_id, MAX(s.wpm) AS v FROM reading_sessions s JOIN users u ON u.id = s.user_id
       WHERE u.share_stats = 1 AND s.day BETWEEN ? AND ? AND s.counted_words >= 1000 AND s.verified = 1
         AND s.doc_words >= ${SPEED_MIN_DOC_WORDS} GROUP BY s.user_id ORDER BY v DESC`
    ).bind(start, end),
    env.DB.prepare(
      `SELECT e.user_id, COUNT(*) AS v FROM user_events e JOIN users u ON u.id = e.user_id
       WHERE u.share_stats = 1 AND e.kind = 'finished' AND e.day BETWEEN ? AND ? GROUP BY e.user_id ORDER BY v DESC`
    ).bind(start, end),
    env.DB.prepare("SELECT id, name FROM users WHERE share_stats = 1")
  ]);
  const names = Object.fromEntries(people.results.map((p) => [p.id, p.name]));
  const rows = (res) => res.results.filter((r) => names[r.user_id]).map((r) => ({ id: r.user_id, name: names[r.user_id], value: r.v }));
  return { words: rows(words), days: rows(days), speed: rows(speed), finished: rows(finished), members: people.results.length };
}

export async function handleGame(request, env, pathname) {
  if (!["/api/achievements", "/api/achievements/check", "/api/compete", "/api/leaderboards"].includes(pathname)) return null;
  const user = await requireUser(request, env);
  const today = todayFrom(request);

  if (pathname === "/api/achievements/check" && request.method === "POST") {
    return json({ unlocked: await evaluate(env, user.id, today) });
  }

  if (pathname === "/api/achievements" && request.method === "GET") {
    const competition = await pastCompetitionResults(env, today.slice(0, 7));
    const { ctx, unlocked, points, level } = await profileFor(env, user.id, today, competition);
    const progress = {};
    for (const a of ACHIEVEMENTS) {
      if (a.progress) {
        const [value, target] = a.progress(ctx);
        progress[a.id] = [Math.min(value || 0, target), target];
      }
    }
    return json({
      points, level,
      unlocked: unlocked.map((r) => ({ id: r.id, at: r.unlocked_at })),
      progress,
      dailyGoal: ctx.dailyGoal
    });
  }

  if (!user.share_stats) return json({ optedIn: false });

  if (pathname === "/api/compete" && request.method === "GET") {
    const requested = new URL(request.url).searchParams.get("month") || "";
    const month = MONTH_RE.test(requested) ? requested : today.slice(0, 7);
    const isCurrent = month === today.slice(0, 7);
    const { days } = monthBounds(month);
    const standings = await monthStandings(env, month);

    // Past champions (most words), newest first.
    const history = [];
    for (let i = 1; i <= 6; i += 1) {
      const d = new Date(`${today.slice(0, 7)}-15T12:00:00Z`);
      d.setUTCMonth(d.getUTCMonth() - i);
      const m = d.toISOString().slice(0, 7);
      const s = await monthStandings(env, m);
      if (s.words.length) history.push({ month: m, champion: s.words.length >= 2 ? s.words[0] : null, top: s.words.slice(0, 3) });
    }

    const { results: feed } = await env.DB.prepare(
      `SELECT a.id, a.unlocked_at AS at, u.name, u.id AS user_id FROM achievements a JOIN users u ON u.id = a.user_id
       WHERE u.share_stats = 1 ORDER BY a.unlocked_at DESC LIMIT 25`
    ).all();

    return json({
      optedIn: true,
      month,
      isCurrent,
      daysLeft: isCurrent ? days - Number(today.slice(8, 10)) : 0,
      standings,
      history,
      feed: feed.filter((f) => ACHIEVEMENTS_BY_ID[f.id]).map((f) => ({ ...f, isYou: f.user_id === user.id }))
    });
  }

  if (pathname === "/api/leaderboards" && request.method === "GET") {
    const competition = await pastCompetitionResults(env, today.slice(0, 7));
    const { results: people } = await env.DB.prepare("SELECT id, name FROM users WHERE share_stats = 1").all();
    const rows = [];
    for (const p of people) {
      const prof = await profileFor(env, p.id, today, competition);
      rows.push({
        id: p.id, name: p.name, isYou: p.id === user.id,
        level: prof.level.level, title: prof.level.title, xp: prof.level.xp, points: prof.points,
        achievements: prof.unlocked.length, words: prof.ctx.totalWords, bestStreak: prof.ctx.bestStreak,
        streak: prof.ctx.streak, topSpeed: prof.ctx.bestWpm[1000] || prof.ctx.bestWpm[500] || 0,
        wins: prof.ctx.wins
      });
    }
    return json({ optedIn: true, members: rows });
  }

  throw new HttpError(405, "Method not allowed");
}

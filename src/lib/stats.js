// Counts words read and time spent reading during playback, per local day,
// plus each sitting (Play until Pause) for speed and time-of-day achievements.
// Everything waits in localStorage until the server has it, so reading
// offline still counts. Server responses can unlock achievements; those are
// announced with a "rafas:achievements" window event.
import { api } from "./api.js";
import { localDay } from "./text.js";

const trackers = new Map();

export function getStatsTracker(userId) {
  if (!trackers.has(userId)) trackers.set(userId, createTracker(userId));
  return trackers.get(userId);
}

export function announceAchievements(ids) {
  if (ids?.length) window.dispatchEvent(new CustomEvent("rafas:achievements", { detail: ids }));
}

export function toast(detail) {
  window.dispatchEvent(new CustomEvent("rafas:toast", { detail }));
}

// Ask the server to award anything newly earned (after finishing or sending a document).
export async function checkAchievements() {
  try {
    const { unlocked } = await api(`/api/achievements/check?today=${localDay()}`, { method: "POST" });
    announceAchievements(unlocked);
  } catch { /* offline: the next stats upload will catch up */ }
}

function createTracker(userId) {
  const key = `rafas:pendingStats:${userId}`;
  const goalKey = `rafas:goalToast:${userId}`;
  let pending = load();
  let playingSince = null;
  let session = null;
  let flushing = null;

  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(key)) || {};
      // Older versions stored just the per-day map.
      return raw.days ? { days: raw.days, sessions: raw.sessions || [] } : { days: raw, sessions: [] };
    } catch { return { days: {}, sessions: [] }; }
  }
  function save() {
    try { localStorage.setItem(key, JSON.stringify(pending)); } catch { /* storage unavailable */ }
  }
  function add(words, ms) {
    const day = localDay();
    const entry = pending.days[day] || (pending.days[day] = { words: 0, ms: 0 });
    entry.words += words;
    entry.ms += ms;
  }
  function checkpoint() {
    if (playingSince == null) return;
    const now = Date.now();
    // Ignore gaps longer than a minute (a sleeping laptop shouldn't count as reading).
    const delta = Math.min(now - playingSince, 60000);
    add(0, delta);
    if (session) session.ms += delta;
    playingSince = now;
  }
  function endSession() {
    if (session && session.words >= 20) pending.sessions.push({ ...session, ms: Math.round(session.ms) });
    session = null;
  }

  return {
    addWords(n) {
      if (n <= 0) return;
      add(n, 0);
      if (session) session.words += n;
    },
    start(wpm) {
      if (playingSince == null) playingSince = Date.now();
      if (!session) {
        const now = new Date();
        session = { day: localDay(now), hour: now.getHours(), words: 0, ms: 0, wpm };
      }
    },
    // A sitting counts at the slowest speed used during it.
    noteWpm(wpm) { if (session) session.wpm = Math.min(session.wpm, wpm); },
    stop() { checkpoint(); playingSince = null; endSession(); save(); },
    async flush({ keepalive = false } = {}) {
      if (flushing) return flushing;
      checkpoint();
      const days = Object.entries(pending.days)
        .filter(([, v]) => v.words > 0 || v.ms > 0)
        .map(([day, v]) => ({ day, words: v.words, ms: Math.round(v.ms) }));
      if (!days.length && !pending.sessions.length) return undefined;
      const snapshot = pending;
      pending = { days: {}, sessions: [] };
      save();
      const today = localDay();
      flushing = api("/api/stats", { method: "POST", body: { today, days, sessions: snapshot.sessions }, keepalive })
        .then((result) => {
          announceAchievements(result.unlocked);
          if (result.dailyGoal && result.todayWords >= result.dailyGoal && localStorage.getItem(goalKey) !== today) {
            try { localStorage.setItem(goalKey, today); } catch { /* ignore */ }
            toast({ icon: "🎯", title: "Daily goal reached", body: `${result.todayWords.toLocaleString()} words today. Nice work.` });
          }
        })
        .catch(() => {
          // Put it back for next time.
          for (const [day, v] of Object.entries(snapshot.days)) {
            const entry = pending.days[day] || (pending.days[day] = { words: 0, ms: 0 });
            entry.words += v.words;
            entry.ms += v.ms;
          }
          pending.sessions = [...snapshot.sessions, ...pending.sessions].slice(-200);
          save();
        })
        .finally(() => { flushing = null; });
      return flushing;
    }
  };
}

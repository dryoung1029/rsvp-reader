// Counts words read and time spent reading during playback, per local day.
// Totals are kept in localStorage until the server has them, so reading
// offline still counts.
import { api } from "./api.js";
import { localDay } from "./text.js";

const trackers = new Map();

export function getStatsTracker(userId) {
  if (!trackers.has(userId)) trackers.set(userId, createTracker(userId));
  return trackers.get(userId);
}

function createTracker(userId) {
  const key = `rafas:pendingStats:${userId}`;
  let pending = load();
  let playingSince = null;
  let flushing = null;

  function load() {
    try { return JSON.parse(localStorage.getItem(key)) || {}; } catch { return {}; }
  }
  function save() {
    try { localStorage.setItem(key, JSON.stringify(pending)); } catch { /* storage unavailable */ }
  }
  function add(words, ms) {
    const day = localDay();
    const entry = pending[day] || (pending[day] = { words: 0, ms: 0 });
    entry.words += words;
    entry.ms += ms;
  }
  function checkpoint() {
    if (playingSince == null) return;
    const now = Date.now();
    // Ignore gaps longer than a minute (a sleeping laptop shouldn't count as reading).
    add(0, Math.min(now - playingSince, 60000));
    playingSince = now;
  }

  return {
    addWords(n) { if (n > 0) add(n, 0); },
    start() { if (playingSince == null) playingSince = Date.now(); },
    stop() { checkpoint(); playingSince = null; save(); },
    async flush({ keepalive = false } = {}) {
      if (flushing) return flushing;
      checkpoint();
      const days = Object.entries(pending)
        .filter(([, v]) => v.words > 0 || v.ms > 0)
        .map(([day, v]) => ({ day, words: v.words, ms: Math.round(v.ms) }));
      if (!days.length) return undefined;
      const snapshot = pending;
      pending = {};
      save();
      flushing = api("/api/stats", { method: "POST", body: { days }, keepalive })
        .catch(() => {
          // Put it back for next time.
          for (const [day, v] of Object.entries(snapshot)) {
            const entry = pending[day] || (pending[day] = { words: 0, ms: 0 });
            entry.words += v.words;
            entry.ms += v.ms;
          }
          save();
        })
        .finally(() => { flushing = null; });
      return flushing;
    }
  };
}

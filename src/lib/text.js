export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function normalizeText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/\[\s*/g, " ")
    .replace(/\s*\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function getWords(value) {
  const clean = normalizeText(value);
  return clean ? clean.split(" ") : [];
}

export function countWords(value) {
  return getWords(value).length;
}

export function makeChunks(words, size) {
  const chunks = [];
  for (let i = 0; i < words.length; i += size) chunks.push(words.slice(i, i + size).join(" "));
  return chunks;
}

// Very common short words are recognised almost instantly, so smart pacing
// shows them a little faster and spends the time on long words and numbers.
// Across ordinary prose the average speed stays close to the chosen WPM.
const COMMON_WORDS = new Set((
  "a an the and or but nor so yet of to in on at by for from with as is am are was were be been being it its " +
  "i me my we us our you your he him his she her they them their this that these those there here then than " +
  "not no do does did done has have had will would can could may might must shall should if when what who " +
  "how why where which while all any each few more most some such only own same too very just up out off over " +
  "into onto about after before again once one two also said like get got go went see saw make made way"
).split(" "));

export function wordWeight(word) {
  const core = String(word).toLowerCase().replace(/[^\p{L}\p{N}'-]/gu, "");
  if (!core) return 1;
  let weight = 1;
  if (core.length <= 4 && COMMON_WORDS.has(core)) weight = 0.85;
  else if (core.length >= 13) weight = 1.5;
  else if (core.length >= 9) weight = 1.25;
  if (/\d/.test(core)) weight = Math.max(weight, 1.3);
  return weight;
}

// Warm-up: start at 70% speed and reach full speed over 30 seconds of reading.
export const WARMUP_MS = 30000;
export function warmupFactor(elapsedMs) {
  return 0.7 + 0.3 * Math.min(1, Math.max(0, elapsedMs) / WARMUP_MS);
}

export function delayForChunk(chunk, wpm, { smart = false, speedFactor = 1 } = {}) {
  const words = chunk.split(" ").filter(Boolean);
  const perWord = 60000 / wpm;
  let delay = smart
    ? words.reduce((sum, w) => sum + perWord * wordWeight(w), 0)
    : perWord * (words.length || 1);
  delay /= speedFactor;
  const last = chunk.slice(-1);
  if (".!?".includes(last)) delay += 260;
  if (",;:".includes(last)) delay += 120;
  if (!smart && chunk.length > 16) delay += 40;
  return Math.max(70, delay);
}

export function localDay(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function pivotIndex(word) {
  if (word.length <= 1) return 0;
  if (word.length <= 5) return 1;
  if (word.length <= 9) return 2;
  if (word.length <= 13) return 3;
  return 4;
}

export function stripHtml(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script, style, nav, header, footer").forEach((el) => el.remove());
  // Keep block boundaries so words from adjacent paragraphs don't fuse together.
  doc.querySelectorAll("p, div, br, li, h1, h2, h3, h4, h5, h6, tr, blockquote").forEach((el) => el.append(" "));
  return doc.body?.textContent || doc.documentElement?.textContent || "";
}

export function looksLikeUrl(value) {
  const trimmed = String(value || "").trim();
  return /^https?:\/\/\S+$/i.test(trimmed);
}

export function firstUrl(value) {
  const match = String(value || "").match(/https?:\/\/[^\s<>"']+/i);
  return match ? match[0] : "";
}

export function formatDuration(minutes) {
  if (!Number.isFinite(minutes) || minutes <= 0) return "done";
  if (minutes < 1) return "<1 min";
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function formatAgo(timestamp) {
  if (!timestamp) return "";
  const seconds = Math.max(0, (Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 86400 * 7) return `${Math.floor(seconds / 86400)}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

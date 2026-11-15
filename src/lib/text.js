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

export function delayForChunk(chunk, wpm) {
  const wordCount = chunk.split(" ").filter(Boolean).length || 1;
  let delay = (60000 / wpm) * wordCount;
  const last = chunk.slice(-1);
  if (".!?".includes(last)) delay += 260;
  if (",;:".includes(last)) delay += 120;
  if (chunk.length > 16) delay += 40;
  return Math.max(70, delay);
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

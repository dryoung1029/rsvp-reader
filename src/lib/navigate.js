// Finding places in a document: word search and a fallback outline for
// documents that arrived without chapters (pasted text, plain PDFs, emails).

const MAX_HITS = 500;

// Lowercase, without accents or surrounding punctuation, so "Darwin's," finds "darwin's".
export function normWord(word) {
  return String(word || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

export function normWords(words) {
  return words.map(normWord);
}

// Every place the query appears, as word offsets. Several words are matched as a
// phrase. The last word matches as a prefix ("photo" finds "photosynthesis");
// put the query in quotes to match whole words only.
export function searchWords(norm, query) {
  const raw = String(query || "").trim();
  const exact = /^".*"$/.test(raw);
  const terms = raw.replace(/^"|"$/g, "").split(/\s+/).map(normWord).filter(Boolean);
  if (!terms.length) return { hits: [], terms: 0, capped: false };
  const last = terms.length - 1;
  const hits = [];
  outer: for (let i = 0; i + last < norm.length; i += 1) {
    for (let k = 0; k <= last; k += 1) {
      const w = norm[i + k];
      if (k < last || exact ? w !== terms[k] : !w.startsWith(terms[k])) continue outer;
    }
    hits.push(i);
    if (hits.length >= MAX_HITS) return { hits, terms: terms.length, capped: true };
  }
  return { hits, terms: terms.length, capped: false };
}

const HEADING_WORD = /^(chapter|part|book|section|act|canto|volume|lesson|unit|article)$/i;
const STANDALONE = /^(prologue|epilogue|preface|foreword|introduction|conclusion|afterword|appendix|acknowledg(e)?ments|glossary|bibliography|index|contents)$/i;
const NUMBER = /^(\d{1,3}|[ivxlcdm]{1,7}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)[.:)]?$/i;
const SENTENCE_START = /^(the|a|an|it|he|she|i|we|they|you|in|on|at|when|this|that|there|but|and|as|after|before|if|my|his|her|our|their|so|then|for|one|once|no|all|some|what|while|now|by)$/i;
const ENDS_SENTENCE = /[.!?:;"”)\]]$/;

function isCapitalised(word) {
  return /^[\p{Lu}\d"'“(]/u.test(word);
}

// Looks for headings like "Chapter 3", "PART TWO", "Prologue" that start a
// sentence, so a mention such as "see chapter 3" is not mistaken for one.
export function detectOutline(words) {
  const marks = [];
  for (let i = 0; i < words.length; i += 1) {
    const w = words[i];
    const atStart = i === 0 || ENDS_SENTENCE.test(words[i - 1]) || (w === w.toUpperCase() && /\p{L}{3}/u.test(w));
    if (!atStart || !isCapitalised(w)) continue;
    const bare = w.replace(/[.:]$/, "");
    let end = -1;
    if (HEADING_WORD.test(bare) && NUMBER.test(words[i + 1] || "")) end = i + 2;
    else if (STANDALONE.test(bare)) end = i + 1;
    if (end < 0) continue;
    // A short title may follow: "Chapter 4 The Long Road" or "CHAPTER IV. THE LONG ROAD".
    let t = end;
    while (t < words.length && t - end < 8 && isCapitalised(words[t]) && (t === end || !ENDS_SENTENCE.test(words[t - 1])) && !HEADING_WORD.test(words[t])) t += 1;
    if (t - end >= 8) t = end; // ran into ordinary text
    // Text arrives without line breaks, so the paragraph after a heading runs
    // straight on. A common opening word followed by a lowercase one starts
    // that paragraph ("Departure It was dark"), so it isn't part of the title.
    if (t - 1 >= end && SENTENCE_START.test(words[t - 1]) && words[t] && /^\p{Ll}/u.test(words[t])) t -= 1;
    const label = words.slice(i, t).join(" ").replace(/[.:;,]+$/, "");
    marks.push({ w: i, t: label });
    i = t - 1;
  }
  // A table of contents lists the headings a few words apart. Skip marks that
  // close to a neighbour, then keep the first time each heading appears (later
  // repeats are usually page headers).
  const spaced = marks.filter((m, k) => (k === 0 || m.w - marks[k - 1].w > 40) && (k === marks.length - 1 || marks[k + 1].w - m.w > 40));
  const seen = new Set();
  const out = spaced.filter((m) => { const key = m.t.toLowerCase(); if (seen.has(key)) return false; seen.add(key); return true; });
  return out.length >= 2 && out.length <= 400 ? out : [];
}

export function snippet(words, at, length, before = 7, after = 12) {
  const start = Math.max(0, at - before);
  const end = Math.min(words.length, at + length + after);
  return {
    lead: start > 0,
    before: words.slice(start, at).join(" "),
    match: words.slice(at, at + length).join(" "),
    after: words.slice(at + length, end).join(" "),
    tail: end < words.length
  };
}

import React, { useDeferredValue, useMemo, useState } from "react";
import Sheet from "./Sheet.jsx";
import { normWords, searchWords, snippet } from "../lib/navigate.js";
import { formatDuration } from "../lib/text.js";

function chapterAt(outline, w) {
  let found = null;
  for (const c of outline) { if (c.w <= w) found = c; else break; }
  return found;
}

// One place to move around a document: search for words, jump to a heading,
// or jump to a point by percentage.
export default function NavigateSheet({ words, outline, outlineGuessed, wordIndex, wpm, initialQuery = "", startTab, onJump, onSearchJump, onClose }) {
  const [query, setQuery] = useState(initialQuery);
  const [tab, setTab] = useState(startTab || (outline.length ? "contents" : "search"));
  const [pct, setPct] = useState(() => (words.length ? Math.round((wordIndex / words.length) * 100) : 0));
  const deferred = useDeferredValue(query);
  const norm = useMemo(() => normWords(words), [words]);
  const result = useMemo(() => searchWords(norm, deferred), [norm, deferred]);
  const searching = query.trim().length > 0;
  const currentChapter = chapterAt(outline, wordIndex);
  const pctWord = Math.min(words.length - 1, Math.floor((pct / 100) * words.length));
  const preview = words.length ? snippet(words, pctWord, 1, 0, 18) : null;

  function go(w) { onJump(w); onClose(); }

  return (
    <Sheet title="Find a place" onClose={onClose}>
      <input
        className="field"
        type="search"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setTab("search"); }}
        onKeyDown={(e) => { if (e.key === "Enter" && result.hits.length) { onSearchJump(query, result.hits, 0); onClose(); } }}
        placeholder="Search this document"
        aria-label="Search this document"
        autoCapitalize="off"
        autoCorrect="off"
        enterKeyHint="search"
      />
      <div className="seg" role="tablist" aria-label="Ways to move">
        <button role="tab" aria-selected={tab === "search"} className={tab === "search" ? "on" : ""} onClick={() => setTab("search")}>Search</button>
        <button role="tab" aria-selected={tab === "contents"} className={tab === "contents" ? "on" : ""} onClick={() => setTab("contents")}>Contents{outline.length ? ` (${outline.length})` : ""}</button>
        <button role="tab" aria-selected={tab === "position"} className={tab === "position" ? "on" : ""} onClick={() => setTab("position")}>Position</button>
      </div>

      {tab === "search" && (
        !searching ? (
          <p className="muted small">Type a word or phrase. Several words are found as a phrase; the last word can be the start of a word. Put it in quotes for whole words only.</p>
        ) : !result.hits.length ? (
          <p className="muted small">No matches for “{deferred}”.</p>
        ) : (
          <>
            <div className="muted small">{result.capped ? `First ${result.hits.length}` : result.hits.length.toLocaleString()} {result.hits.length === 1 ? "match" : "matches"}. Tap one to read from there.</div>
            <ol className="hit-list">
              {result.hits.map((w, i) => {
                const s = snippet(words, w, result.terms);
                const ch = chapterAt(outline, w);
                return (
                  <li key={w}>
                    <button className="hit" onClick={() => { onSearchJump(deferred, result.hits, i); onClose(); }}>
                      <span className="hit-text">
                        {s.lead && "… "}{s.before} <mark>{s.match}</mark> {s.after}{s.tail && " …"}
                      </span>
                      <span className="muted small">{ch ? `${ch.t} · ` : ""}{Math.round((w / words.length) * 100)}%{w < wordIndex ? " · before you" : ""}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </>
        )
      )}

      {tab === "contents" && (
        outline.length ? (
          <>
            {outlineGuessed && <div className="muted small">Found from headings in the text, like “Chapter 3”.</div>}
            <ol className="chapter-list">
              {outline.map((c, i) => {
                const end = outline[i + 1]?.w ?? words.length;
                const done = wordIndex >= end;
                const isCurrent = currentChapter === c;
                return (
                  <li key={`${c.w}-${i}`}>
                    <button className={`chapter-item${isCurrent ? " current" : ""}`} onClick={() => go(c.w)}>
                      <span className="chapter-title">{c.t || `Chapter ${i + 1}`}</span>
                      <span className="muted small">{done ? "Read" : isCurrent ? `${formatDuration((end - wordIndex) / wpm)} left` : formatDuration((end - c.w) / wpm)}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </>
        ) : (
          <p className="muted small">This document has no chapters or headings RAFAS can find. Use Search or Position instead.</p>
        )
      )}

      {tab === "position" && preview && (
        <div className="pos-jump">
          <label className="slider">Go to {pct}%<input type="range" min="0" max="100" step="1" value={pct} onChange={(e) => setPct(Number(e.target.value))} /></label>
          <div className="row">
            {[-10, -1, 1, 10].map((d) => <button key={d} className="btn sm" onClick={() => setPct((p) => Math.min(100, Math.max(0, p + d)))}>{d > 0 ? `+${d}` : d}%</button>)}
          </div>
          <p className="hit-text"><mark>{preview.match}</mark> {preview.after}{preview.tail && " …"}</p>
          <div className="muted small">{chapterAt(outline, pctWord)?.t || ""}</div>
          <button className="btn primary" onClick={() => go(pctWord)}>Read from here</button>
        </div>
      )}
    </Sheet>
  );
}

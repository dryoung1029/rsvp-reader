import React from "react";

const BEFORE = 45;
const AFTER = 45;

// Shown under the word while paused: the surrounding text with your place
// highlighted. Tap any word to continue from there.
export default function ContextView({ words, wordIndex, chunkSize, onJump }) {
  const start = Math.max(0, wordIndex - BEFORE);
  const end = Math.min(words.length, wordIndex + chunkSize + AFTER);
  return (
    <div className="context" aria-label="Surrounding text. Tap a word to continue from there.">
      {start > 0 && <span className="muted">… </span>}
      {words.slice(start, end).map((word, i) => {
        const idx = start + i;
        const current = idx >= wordIndex && idx < wordIndex + chunkSize;
        return (
          <React.Fragment key={idx}>
            <button type="button" className={current ? "cw current" : "cw"} onClick={(e) => { e.stopPropagation(); onJump(idx); }}>{word}</button>{" "}
          </React.Fragment>
        );
      })}
      {end < words.length && <span className="muted">…</span>}
    </div>
  );
}

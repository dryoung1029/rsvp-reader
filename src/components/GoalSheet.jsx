import React, { useState } from "react";
import Sheet from "./Sheet.jsx";
import { formatDuration } from "../lib/text.js";

const WORD_PRESETS = [500, 1000, 2500, 5000];
const MINUTE_PRESETS = [5, 10, 15, 30];

// Pick how much to read this session. Reading pauses on its own when it's done.
export default function GoalSheet({ chapter, nextChapter, wordsLeft, wpm, onSet, onClose }) {
  const [words, setWords] = useState("");
  const [minutes, setMinutes] = useState("");

  function set(goal) { onSet(goal); onClose(); }

  return (
    <Sheet title="Set a reading goal" onClose={onClose}>
      <p className="muted small">RAFAS pauses when you reach it. Words and time stop at the end of a sentence.</p>

      {chapter && (
        <div className="goal-group">
          <h3>Chapter</h3>
          <button className="btn goal-choice" onClick={() => set({ type: "chapter", targetWord: chapter.end, label: chapter.title })}>
            <span>Finish “{chapter.title}”</span>
            <span className="muted small">{formatDuration(chapter.wordsLeft / wpm)}</span>
          </button>
          {nextChapter && (
            <button className="btn goal-choice" onClick={() => set({ type: "chapter", targetWord: nextChapter.end, label: nextChapter.title })}>
              <span>Through “{nextChapter.title}”</span>
              <span className="muted small">{formatDuration(nextChapter.wordsLeft / wpm)}</span>
            </button>
          )}
        </div>
      )}

      <div className="goal-group">
        <h3>Words</h3>
        <div className="row">
          {WORD_PRESETS.filter((n) => n < wordsLeft * 1.2).map((n) => (
            <button key={n} className="btn sm" onClick={() => set({ type: "words", amount: n })}>{n.toLocaleString()}</button>
          ))}
        </div>
        <form className="row" onSubmit={(e) => { e.preventDefault(); const n = Math.round(Number(words)); if (n > 0) set({ type: "words", amount: n }); }}>
          <input className="field" inputMode="numeric" value={words} onChange={(e) => setWords(e.target.value.replace(/\D/g, ""))} placeholder="Other amount" aria-label="Number of words" />
          <button className="btn" type="submit" disabled={!Number(words)}>Set</button>
        </form>
      </div>

      <div className="goal-group">
        <h3>Time</h3>
        <div className="row">
          {MINUTE_PRESETS.map((n) => <button key={n} className="btn sm" onClick={() => set({ type: "time", amount: n })}>{n} min</button>)}
        </div>
        <form className="row" onSubmit={(e) => { e.preventDefault(); const n = Number(minutes); if (n > 0) set({ type: "time", amount: n }); }}>
          <input className="field" inputMode="decimal" value={minutes} onChange={(e) => setMinutes(e.target.value.replace(/[^\d.]/g, ""))} placeholder="Other, in minutes" aria-label="Minutes" />
          <button className="btn" type="submit" disabled={!Number(minutes)}>Set</button>
        </form>
        <div className="muted small">Only time spent reading counts, not time paused.</div>
      </div>
    </Sheet>
  );
}

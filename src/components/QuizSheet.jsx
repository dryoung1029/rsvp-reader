import React, { useEffect, useState } from "react";
import Sheet from "./Sheet.jsx";
import { api } from "../lib/api.js";
import { announceAchievements } from "../lib/stats.js";
import { localDay } from "../lib/text.js";

// Three questions on what you just read. Passing makes that reading count
// toward achievements, competitions and leaderboards.
export default function QuizSheet({ docId, title, prepare, onClose, onDone }) {
  const [quiz, setQuiz] = useState(null);
  const [answers, setAnswers] = useState([]);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const [deadline, setDeadline] = useState(0);
  const [left, setLeft] = useState(0);
  const answersRef = React.useRef([]);
  answersRef.current = answers;

  async function load() {
    setBusy(true);
    setError("");
    setResult(null);
    setAnswers([]);
    try {
      await prepare();
      const { quiz: q } = await api("/api/quiz", { method: "POST", body: { docId } });
      setQuiz(q);
      setDeadline(Date.now() + q.secondsLeft * 1000);
      setLeft(q.secondsLeft);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  async function submit(final = answers) {
    setBusy(true);
    try {
      const r = await api(`/api/quiz/${quiz.id}/answer?today=${localDay()}`, { method: "POST", body: { answers: final } });
      setResult(r);
      announceAchievements(r.unlocked);
      onDone(r);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  // Countdown; when time runs out, whatever is chosen is submitted.
  useEffect(() => {
    if (!quiz || result || !deadline) return undefined;
    const t = setInterval(() => {
      const s = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setLeft(s);
      if (s === 0) { clearInterval(t); submit(answersRef.current); }
    }, 250);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quiz, result, deadline]);

  const ready = quiz && answers.filter((a) => a != null).length === quiz.questions.length;

  return (
    <Sheet title="Quick check" onClose={onClose}>
      {busy && !quiz && !error && <p className="muted">Writing 3 questions about what you just read in "{title}"...</p>}
      {error && <p className="error">{error}</p>}
      {quiz && !result && (
        <>
          <div className="quiz-head">
            <p className="muted small">
              Answer all 3 correctly to count this reading toward achievements and the competition.
              {quiz.attempt > 1 ? " Last try for this reading." : ""}
            </p>
            <div className={`quiz-timer${left <= 15 ? " low" : ""}`} aria-live="off" aria-label={`${left} seconds left`}>{Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}</div>
          </div>
          <ol className="quiz">
            {quiz.questions.map((q, i) => (
              <li key={i}>
                <div className="quiz-q">{q.question}</div>
                <div className="quiz-options" role="radiogroup" aria-label={`Question ${i + 1}`}>
                  {q.options.map((o, j) => (
                    <button
                      key={j}
                      role="radio"
                      aria-checked={answers[i] === j}
                      className={`quiz-option${answers[i] === j ? " on" : ""}`}
                      onClick={() => setAnswers((a) => { const n = [...a]; n[i] = j; return n; })}
                    >
                      <span className="quiz-letter">{"ABCD"[j]}</span>{o}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ol>
          <button className="btn primary" disabled={!ready || busy} onClick={() => submit()}>{busy ? "Checking..." : "Check answers"}</button>
        </>
      )}
      {quiz && result && (
        <>
          <div className={`quiz-result ${result.passed ? "pass" : "fail"}`}>
            {result.passed
              ? <><b>3 for 3.</b> {result.counted ? `${result.counted.toLocaleString()} words now count toward your achievements and the competition.` : "Nice. You'd already counted this part, so nothing new to add."}{result.finished ? " And that's the whole document finished." : ""}</>
              : <><b>{result.timedOut ? "Time's up." : "Not quite."}</b> {result.attemptsLeft ? "You get one more try with new questions." : "No tries left for this reading. It still counts in your own stats, just not for achievements or the competition."}</>}
          </div>
          <ol className="quiz">
            {quiz.questions.map((q, i) => {
              const r = result.results[i];
              return (
                <li key={i}>
                  <div className="quiz-q">{r.correct ? "✓" : "✗"} {q.question}</div>
                  <div className="muted small">Answer: <b>{q.options[r.answer]}</b>{r.correct ? "" : r.chosen != null ? ` (you chose ${q.options[r.chosen]})` : ""}</div>
                  {!r.correct && r.explanation && <div className="muted small">{r.explanation}</div>}
                </li>
              );
            })}
          </ol>
          <div className="row">
            {!result.passed && result.attemptsLeft > 0 && <button className="btn primary" onClick={load}>Try new questions</button>}
            <button className="btn" onClick={onClose}>{result.passed ? "Keep reading" : "Close"}</button>
          </div>
        </>
      )}
    </Sheet>
  );
}

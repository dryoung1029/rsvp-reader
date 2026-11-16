// Comprehension quizzes. Reading is recorded straight away for personal stats,
// but it only counts toward achievements, competitions and leaderboards after
// the reader answers 3 questions about it correctly. That stops anyone from
// turning the speed up to 1,000 wpm and letting it run.
import Anthropic from "@anthropic-ai/sdk";
import { HttpError, json, readJson } from "./util.js";
import { requireUser } from "./auth.js";
import { evaluate, logEvent, utcDay } from "./game.js";
import {
  flag, mergeRanges, rangeLength, newWordsIn, diversity, fingerprints,
  DAILY_COUNTED_CAP, FINISH_COVERAGE, QUIZ_SECONDS, QUIZ_GRACE_MS, MIN_DIVERSITY, SEND_MIN_WORDS
} from "./fairplay.js";

export const QUIZ_MIN_WORDS = 300;   // a quiz is offered once this much reading is waiting
const QUIZ_FLOOR_WORDS = 120;        // smallest stretch you can ask to be quizzed on
const MAX_ATTEMPTS = 2;              // a fresh set of questions on the second try
const MODEL = "claude-opus-5-5";
const ID_RE = /^[0-9a-f-]{36}$/;

const QUIZ_SCHEMA = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          question: { type: "string" },
          options: { type: "array", items: { type: "string" } },
          answer_index: { type: "integer" },
          explanation: { type: "string" }
        },
        required: ["question", "options", "answer_index", "explanation"],
        additionalProperties: false
      }
    }
  },
  required: ["questions"],
  additionalProperties: false
};

const SYSTEM = `You write quick reading-comprehension checks for a speed-reading app used by a family (high school, college and law school students, and parents).
Given a passage someone just read, write exactly 3 multiple-choice questions that someone who actually read and understood the passage can answer, and someone who didn't, can't.
- Each question covers a different part of the passage (beginning, middle, end, or the labelled sections).
- Ask about ideas, events, claims, reasons or who-did-what that the passage states clearly. Avoid trick questions, exact numbers, dates or spellings unless they are central, and anything that needs outside knowledge.
- Give 4 options each: one clearly correct, three plausible but clearly wrong for anyone who read it. Keep options short and similar in length.
- explanation: one short sentence saying where the passage supports the answer.
- Paraphrase: don't copy distinctive phrases from the passage into questions or options, so the answer can't be found by searching the text for the same words.
- Plain language. No "according to the passage" filler.`;

// ---------- Text ----------

async function docText(env, docId) {
  const { results } = await env.DB.prepare("SELECT data FROM document_text WHERE doc_id = ? ORDER BY seq").bind(docId).all();
  if (!results.length) throw new HttpError(409, "This document hasn't finished uploading yet. Try again in a moment.");
  const blob = new Blob(results.map((r) => new Uint8Array(r.data)));
  return await new Response(blob.stream().pipeThrough(new DecompressionStream("gzip"))).text();
}

// The passage for a set of sittings: from the earliest start to the latest end.
// Long stretches are sampled as three sections so the questions span all of it.
function passageFor(words, start, end) {
  const span = words.slice(Math.max(0, start), Math.min(words.length, end + 1));
  if (span.length <= 2400) return { text: span.join(" "), sections: 1 };
  const part = 750;
  const picks = [0, Math.floor(span.length / 2 - part / 2), span.length - part];
  return {
    text: picks.map((p, i) => `[Section ${i + 1} of 3]\n${span.slice(p, p + part).join(" ")}`).join("\n\n"),
    sections: 3
  };
}

// ---------- Question writers ----------

function shuffleOptions(q) {
  const order = q.options.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  return { ...q, options: order.map((i) => q.options[i]), answer: order.indexOf(q.answer) };
}

async function claudeQuestions(env, passage) {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 4000,
    // If Claude declines a passage, the API retries on a fallback model in the same call.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: { type: "json_schema", schema: QUIZ_SCHEMA } },
    system: SYSTEM,
    messages: [{ role: "user", content: `<passage>\n${passage.text}\n</passage>\n\nWrite the 3 questions.` }]
  });
  if (response.stop_reason === "refusal") throw new Error("refused");
  const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  const parsed = JSON.parse(text);
  const questions = (parsed.questions || [])
    .filter((q) => q.question && Array.isArray(q.options) && q.options.length >= 3 && Number.isInteger(q.answer_index) && q.answer_index >= 0 && q.answer_index < q.options.length)
    .slice(0, 3)
    .map((q) => shuffleOptions({ question: q.question.trim(), options: q.options.slice(0, 4).map((o) => String(o).trim()), answer: Math.min(q.answer_index, 3), explanation: q.explanation }));
  if (questions.length < 3) throw new Error("not enough questions");
  return questions;
}

const STOP = new Set("about above after again against because been before being below between could during every their there these those through under until where which while would should other into over such than that them then they this were what when with your from have more most some very just also only".split(" "));

// No-AI fallback: fill-in-the-blank questions taken from the passage itself.
function clozeQuestions(passageText) {
  const plain = passageText.replace(/\[Section \d of 3\]\n/g, "");
  // Split after . ! or ? even when a closing quote or bracket follows.
  const sentences = plain.split(/(?<=[.!?]["'\u201d\u2019)\]]?)\s+/).map((s) => s.trim()).filter((s) => {
    const n = s.split(/\s+/).length;
    return n >= 8 && n <= 40;
  });
  const vocab = [...new Set(plain.toLowerCase().match(/\b[a-z]{5,}\b/g) || [])].filter((w) => !STOP.has(w));
  if (sentences.length < 3 || vocab.length < 8) throw new HttpError(422, "That reading is too short or repetitive to quiz on. Keep reading a bit more.");
  const picks = [0, Math.floor(sentences.length / 2), sentences.length - 1];
  const used = new Set();
  return picks.map((idx) => {
    let s = sentences[idx];
    for (let k = 0; k < sentences.length && used.has(s); k += 1) s = sentences[(idx + k) % sentences.length];
    used.add(s);
    const candidates = (s.match(/\b[A-Za-z]{5,}\b/g) || []).filter((w) => !STOP.has(w.toLowerCase()));
    const target = candidates.sort((a, b) => b.length - a.length)[0] || s.split(/\s+/)[0];
    const lower = target.toLowerCase();
    const distractors = vocab.filter((w) => w !== lower && !s.toLowerCase().includes(w))
      .sort((a, b) => Math.abs(a.length - lower.length) - Math.abs(b.length - lower.length) || (a < b ? -1 : 1))
      .slice(0, 12);
    const chosen = [];
    while (chosen.length < 3 && distractors.length) chosen.push(distractors.splice(crypto.getRandomValues(new Uint32Array(1))[0] % distractors.length, 1)[0]);
    const match = (w) => (target[0] === target[0].toUpperCase() ? w[0].toUpperCase() + w.slice(1) : w);
    return shuffleOptions({
      question: `Fill in the blank: "${s.replace(target, "_____")}"`,
      options: [target, ...chosen.map(match)],
      answer: 0,
      explanation: `The passage says: "${s}"`
    });
  });
}

// ---------- Helpers ----------

async function pendingSessions(env, userId, docId) {
  const { results } = await env.DB.prepare(
    "SELECT id, day, words, ms, start_word, end_word FROM reading_sessions WHERE user_id = ? AND doc_id = ? AND verified = 0 ORDER BY id"
  ).bind(userId, docId).all();
  return results;
}

export async function pendingSummary(env, userId) {
  const { results } = await env.DB.prepare(
    "SELECT doc_id, SUM(words) AS words FROM reading_sessions WHERE user_id = ? AND verified = 0 AND doc_id IS NOT NULL GROUP BY doc_id"
  ).bind(userId).all();
  return results.map((r) => ({ docId: r.doc_id, words: r.words, ready: r.words >= QUIZ_MIN_WORDS }));
}

function publicQuiz(row, attemptsLeft) {
  const questions = JSON.parse(row.questions).map(({ question, options }) => ({ question, options }));
  return {
    id: row.id, docId: row.doc_id, words: row.words, attempt: row.attempt, attemptsLeft, questions,
    secondsLeft: Math.max(0, Math.round(((row.expires_at || 0) - Date.now()) / 1000)), seconds: QUIZ_SECONDS
  };
}

const placeholders = (n) => Array.from({ length: n }, () => "?").join(",");

async function setSessions(env, userId, ids, verified) {
  if (!ids.length) return;
  await env.DB.prepare(`UPDATE reading_sessions SET verified = ? WHERE user_id = ? AND verified = 0 AND id IN (${placeholders(ids.length)})`)
    .bind(verified, userId, ...ids).run();
}

// Coverage is shared between a document and any copy of it (matched by fingerprint),
// so the same text can't be counted twice by adding it again.
function coverKeys(docId, fps) {
  return [`doc:${docId}`, ...(fps || []).map((f) => `fp:${f}`)];
}

async function loadCoverage(env, userId, keys) {
  const { results } = await env.DB.prepare(`SELECT ranges FROM doc_coverage WHERE user_id = ? AND cover_key IN (${placeholders(keys.length)})`)
    .bind(userId, ...keys).all();
  return mergeRanges(results.flatMap((r) => JSON.parse(r.ranges)));
}

// ---------- Handlers ----------

async function createQuiz(request, env, user) {
  const body = await readJson(request);
  const docId = String(body.docId || "");
  if (!ID_RE.test(docId)) throw new HttpError(400, "Pick a document first.");
  const doc = await env.DB.prepare("SELECT id, title, word_count FROM documents WHERE id = ? AND user_id = ?").bind(docId, user.id).first();
  if (!doc) throw new HttpError(404, "That document isn't in your library on the server yet. Try again in a moment.");

  const sessions = await pendingSessions(env, user.id, docId);
  const words = sessions.reduce((a, x) => a + x.words, 0);
  if (words < QUIZ_FLOOR_WORDS) throw new HttpError(409, "Read a little more of this first. Quizzes cover at least a couple of minutes of reading.");
  const ids = sessions.map((x) => x.id);
  const key = JSON.stringify(ids);

  // Reuse an open quiz for exactly these sittings (unless its time ran out); count earlier tries.
  const { results: earlier } = await env.DB.prepare(
    "SELECT * FROM quizzes WHERE user_id = ? AND doc_id = ? AND session_ids = ? ORDER BY created_at"
  ).bind(user.id, docId, key).all();
  let failed = earlier.filter((q) => q.status === "failed").length;
  const open = earlier.find((q) => q.status === "open");
  if (open) {
    if ((open.expires_at || 0) + QUIZ_GRACE_MS > Date.now()) return json({ quiz: publicQuiz(open, MAX_ATTEMPTS - failed) });
    await env.DB.prepare("UPDATE quizzes SET status = 'failed', answered_at = ? WHERE id = ?").bind(Date.now(), open.id).run();
    failed += 1;
  }
  if (failed >= MAX_ATTEMPTS) {
    await setSessions(env, user.id, ids, -1);
    throw new HttpError(409, "No tries left for that reading. It still counts in your own stats.");
  }

  const text = await docText(env, docId);
  const allWords = text.split(" ");
  const start = Math.min(...sessions.map((x) => x.start_word ?? 0));
  const end = Math.min(allWords.length - 1, Math.max(...sessions.map((x) => x.end_word ?? start)));

  // Remember what this text looks like, and how varied it is.
  const fps = await fingerprints(allWords);
  const quality = diversity(allWords.slice(0, 20000));
  await env.DB.prepare("UPDATE documents SET fingerprints = ?, quality = ? WHERE id = ?").bind(JSON.stringify(fps), quality, docId).run();
  const passageWords = allWords.slice(start, end + 1);
  if (quality < MIN_DIVERSITY || diversity(passageWords) < MIN_DIVERSITY) {
    await setSessions(env, user.id, ids, -4);
    await flag(env, user.id, "repetitive", `"${doc.title}" is too repetitive to count`).run();
    throw new HttpError(422, "This text is too repetitive to count toward achievements. It still counts in your own stats.");
  }
  const passage = passageFor(allWords, start, end);

  let questions;
  let source = "cloze";
  if (env.ANTHROPIC_API_KEY) {
    try {
      questions = await claudeQuestions(env, passage);
      source = "claude";
    } catch (error) {
      console.warn("Claude quiz failed, using fill-in-the-blank", error instanceof Anthropic.APIError ? `${error.status} ${error.message}` : error.message);
    }
  }
  if (!questions) questions = clozeQuestions(passage.text);

  const now = Date.now();
  const row = {
    id: crypto.randomUUID(), user_id: user.id, doc_id: docId, session_ids: key, words,
    questions: JSON.stringify(questions), source, attempt: failed + 1, status: "open", created_at: now,
    expires_at: now + QUIZ_SECONDS * 1000
  };
  await env.DB.prepare(
    "INSERT INTO quizzes (id, user_id, doc_id, session_ids, words, questions, source, attempt, status, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(row.id, row.user_id, row.doc_id, row.session_ids, row.words, row.questions, row.source, row.attempt, row.status, row.created_at, row.expires_at).run();
  return json({ quiz: publicQuiz(row, MAX_ATTEMPTS - failed) }, 201);
}

// Credits newly read words from passed sittings: rereading counts once, there's a
// daily ceiling, and finishing or a send only counts once most of it has been read.
async function creditReading(env, user, quiz, ids, today) {
  const statements = [];
  const doc = await env.DB.prepare("SELECT id, word_count, source, finish_counted, edited_at, fingerprints, title FROM documents WHERE id = ? AND user_id = ?")
    .bind(quiz.doc_id, user.id).first();
  if (!doc) return { statements, credited: 0, finished: false };
  const keys = coverKeys(doc.id, doc.fingerprints ? JSON.parse(doc.fingerprints) : []);
  let covered = await loadCoverage(env, user.id, keys);

  const { results: sessions } = await env.DB.prepare(
    `SELECT id, day, words, ms, wpm, start_word, end_word FROM reading_sessions WHERE user_id = ? AND verified = 0 AND id IN (${placeholders(ids.length)}) ORDER BY started_at, id`
  ).bind(user.id, ...ids).all();

  const days = [...new Set(sessions.map((x) => x.day))];
  const { results: dayRows } = days.length
    ? await env.DB.prepare(`SELECT day, verified_words FROM reading_days WHERE user_id = ? AND day IN (${placeholders(days.length)})`).bind(user.id, ...days).all()
    : { results: [] };
  const dayUsed = new Map(dayRows.map((r) => [r.day, r.verified_words]));
  const best = await env.DB.prepare("SELECT MAX(wpm) AS w FROM reading_sessions WHERE user_id = ? AND verified = 1 AND counted_words >= 500").bind(user.id).first();

  let credited = 0;
  const byDay = new Map();
  for (const x of sessions) {
    const a = Math.max(0, x.start_word ?? 0);
    const b = Math.min(doc.word_count - 1, x.end_word ?? a);
    let fresh = b >= a ? Math.min(x.words, newWordsIn([a, b], covered)) : 0;
    if (b >= a) covered = mergeRanges([...covered, [a, b]]);
    const used = dayUsed.get(x.day) || 0;
    if (used + fresh > DAILY_COUNTED_CAP) {
      statements.push(flag(env, user.id, "daily cap", `hit the daily limit on ${x.day}`));
      fresh = Math.max(0, DAILY_COUNTED_CAP - used);
    }
    dayUsed.set(x.day, used + fresh);
    const freshMs = x.words ? Math.round((x.ms * fresh) / x.words) : 0;
    statements.push(env.DB.prepare("UPDATE reading_sessions SET verified = 1, counted_words = ?, doc_words = ? WHERE id = ?").bind(fresh, doc.word_count, x.id));
    if (fresh) {
      const d = byDay.get(x.day) || { words: 0, ms: 0 };
      d.words += fresh; d.ms += freshMs; byDay.set(x.day, d);
      credited += fresh;
    }
    if (fresh >= 500 && best?.w && x.wpm > best.w + 200) {
      statements.push(flag(env, user.id, "speed jump", `${x.wpm} wpm after a previous best of ${best.w}`));
    }
  }
  for (const [day, d] of byDay) {
    statements.push(env.DB.prepare(
      `INSERT INTO reading_days (user_id, day, words, ms, verified_words, verified_ms) VALUES (?, ?, 0, 0, ?, ?)
       ON CONFLICT (user_id, day) DO UPDATE SET verified_words = verified_words + excluded.verified_words, verified_ms = verified_ms + excluded.verified_ms`
    ).bind(user.id, day, d.words, d.ms));
  }
  for (const k of keys) {
    statements.push(env.DB.prepare(
      "INSERT INTO doc_coverage (user_id, cover_key, ranges) VALUES (?, ?, ?) ON CONFLICT (user_id, cover_key) DO UPDATE SET ranges = excluded.ranges"
    ).bind(user.id, k, JSON.stringify(covered)));
  }

  // Finished = most of the document has counted (skipping to the end doesn't do it).
  const read = rangeLength(covered);
  let finished = false;
  if (!doc.finish_counted && doc.word_count > 0 && read >= doc.word_count * FINISH_COVERAGE) {
    finished = true;
    statements.push(env.DB.prepare("UPDATE documents SET finish_counted = 1, finished_at = COALESCE(finished_at, ?) WHERE id = ?").bind(Date.now(), doc.id));
    // Edited documents count as finished, but not toward the long-book achievement.
    statements.push(logEvent(env, user.id, "finished", { value: doc.edited_at ? 0 : doc.word_count, meta: doc.source, day: today }));
  }

  // A document someone sent you: their send counts once you've read some of it.
  const senders = [];
  if (read >= SEND_MIN_WORDS) {
    const { results: sends } = await env.DB.prepare("SELECT * FROM sends WHERE recipient_doc_id = ? AND recipient_id = ? AND counted = 0").bind(doc.id, user.id).all();
    for (const snd of sends) {
      const dup = await env.DB.prepare("SELECT 1 FROM sends WHERE sender_id = ? AND recipient_id = ? AND source_doc_id = ? AND counted = 1")
        .bind(snd.sender_id, snd.recipient_id, snd.source_doc_id).first();
      statements.push(env.DB.prepare("UPDATE sends SET counted = 1 WHERE id = ?").bind(snd.id));
      if (dup) continue;
      statements.push(logEvent(env, snd.sender_id, "sent", { value: 1 }));
      statements.push(logEvent(env, user.id, "received", { value: 1 }));
      senders.push(snd.sender_id);
    }
  }
  return { statements, credited, finished, senders };
}

async function answerQuiz(request, env, user, quizId) {
  const quiz = await env.DB.prepare("SELECT * FROM quizzes WHERE id = ? AND user_id = ?").bind(quizId, user.id).first();
  if (!quiz) throw new HttpError(404, "Quiz not found.");
  if (quiz.status !== "open") throw new HttpError(409, "That quiz has already been answered.");
  const body = await readJson(request);
  const answers = Array.isArray(body.answers) ? body.answers.map(Number) : [];
  const questions = JSON.parse(quiz.questions);
  const timedOut = Date.now() > (quiz.expires_at || Infinity) + QUIZ_GRACE_MS;
  const results = questions.map((q, i) => ({ correct: !timedOut && answers[i] === q.answer, answer: q.answer, chosen: answers[i] ?? null, explanation: q.explanation }));
  const passed = results.every((r) => r.correct);
  const ids = JSON.parse(quiz.session_ids);
  const today = new URL(request.url).searchParams.get("today") || utcDay();

  const statements = [env.DB.prepare("UPDATE quizzes SET status = ?, answered_at = ? WHERE id = ?").bind(passed ? "passed" : "failed", Date.now(), quiz.id)];
  let credit = { credited: 0, finished: false, senders: [] };
  if (passed) {
    credit = await creditReading(env, user, quiz, ids, today);
    statements.push(...credit.statements);
    statements.push(logEvent(env, user.id, "quiz", { value: quiz.attempt, meta: quiz.source, day: today }));
  } else if (quiz.attempt >= MAX_ATTEMPTS) {
    // Out of tries: this stretch stays in personal stats but won't count for the game.
    statements.push(env.DB.prepare(`UPDATE reading_sessions SET verified = -1 WHERE user_id = ? AND verified = 0 AND id IN (${placeholders(ids.length)})`).bind(user.id, ...ids));
  }
  await env.DB.batch(statements);

  const unlocked = passed ? await evaluate(env, user.id, today) : [];
  // Senders whose send just counted get their achievements awarded now and shown next time they open RAFAS.
  for (const senderId of credit.senders || []) await evaluate(env, senderId, today, { claim: false });
  return json({
    passed,
    timedOut,
    results,
    words: quiz.words,
    counted: credit.credited,
    finished: credit.finished,
    attemptsLeft: passed ? 0 : Math.max(0, MAX_ATTEMPTS - quiz.attempt),
    unlocked
  });
}

export async function handleQuiz(request, env, pathname) {
  if (!pathname.startsWith("/api/quiz")) return null;
  const user = await requireUser(request, env);
  if (pathname === "/api/quiz" && request.method === "POST") return createQuiz(request, env, user);
  if (pathname === "/api/quiz/pending" && request.method === "GET") return json({ pending: await pendingSummary(env, user.id), minWords: QUIZ_MIN_WORDS });
  const m = pathname.match(/^\/api\/quiz\/([0-9a-f-]{36})\/answer$/);
  if (m && request.method === "POST") return answerQuiz(request, env, user, m[1]);
  throw new HttpError(404, "Not found");
}

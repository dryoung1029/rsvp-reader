import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  clamp, normalizeText, getWords, makeChunks, delayForChunk, pivotIndex,
  firstUrl, formatDuration, formatAgo
} from "./lib/text.js";
import { readDocumentFile, ACCEPTED_FILES } from "./lib/parsers.js";
import {
  listDocs, getDoc, getText, addDoc, updateDoc, touchDoc, deleteDoc,
  listPendingShares, deletePendingShare
} from "./lib/library.js";
import { Link, navigate, usePath } from "./router.jsx";
import { APP_NAME, APP_LONG_NAME, DEFAULT_INBOX_EMAIL } from "./config.js";
import About from "./pages/About.jsx";
import Help from "./pages/Help.jsx";
import Privacy from "./pages/Privacy.jsx";

const SAMPLE_TEXT = `Welcome to RAFAS. Words appear one at a time in the same spot, so your eyes can stay still. The red letter is the pivot: rest your eyes on it. Tap the middle to pause, or tap the left or right edge to jump back or forward a sentence. Add an article, a PDF, an EPUB or some pasted text, and RAFAS will save it to your library and remember your place.`;

const SOURCE_LABEL = { paste: "Pasted", url: "Web", file: "File", share: "Shared", inbox: "Inbox" };
const PAGE_TITLES = { "/": APP_NAME, "/about": `About · ${APP_NAME}`, "/help": `Help · ${APP_NAME}`, "/privacy": `Privacy · ${APP_NAME}` };

const store = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* storage unavailable */ } },
  remove(key) { try { localStorage.removeItem(key); } catch { /* storage unavailable */ } }
};

function titleFromText(text) {
  const words = getWords(text).slice(0, 8).join(" ");
  return words.length > 60 ? `${words.slice(0, 57)}...` : words || "Untitled";
}

function docProgress(doc) {
  if (!doc?.wordCount) return 0;
  return Math.min(100, Math.round(((doc.readWords || 0) / doc.wordCount) * 100));
}

// A share or email that is mostly just a link should be read as that article.
function sharedUrl({ url, text }) {
  if (url) return url;
  const link = firstUrl(text);
  return link && getWords(text).length <= 40 ? link : "";
}

const SENTENCE_END = /[.!?…]["'”’)\]]*$/;
function prevSentenceStart(chunks, i) {
  let j = i - 1;
  if (j >= 0 && SENTENCE_END.test(chunks[j])) j -= 1; // already at a sentence start: go to the previous one
  while (j >= 0 && !SENTENCE_END.test(chunks[j])) j -= 1;
  return Math.max(0, j + 1);
}
function nextSentenceStart(chunks, i) {
  let j = i;
  while (j < chunks.length - 1 && !SENTENCE_END.test(chunks[j])) j += 1;
  return Math.min(j + 1, Math.max(0, chunks.length - 1));
}

async function extractArticle(url) {
  const response = await fetch("/api/extract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url })
  });
  const data = await response.json().catch(() => ({}));
  const clean = normalizeText(data.text || "");
  if (!response.ok || !clean) throw new Error(data.error || "No readable article text found.");
  return { text: clean, title: data.title || url };
}

function initialTheme() {
  const saved = store.get("rsvp:theme") || (store.get("rsvp:dark") === "false" ? "light" : null);
  if (saved) return saved;
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function PivotWord({ text, enabled }) {
  if (!text) return <span>Add something to read</span>;
  if (!enabled || text.includes(" ")) return <span>{text}</span>;

  const marks = ".,!?;:()[]{}\"'“”‘’…";
  let start = 0;
  let end = text.length - 1;
  while (start < text.length && marks.includes(text[start])) start += 1;
  while (end > start && marks.includes(text[end])) end -= 1;

  const lead = text.slice(0, start);
  const core = text.slice(start, end + 1) || text;
  const trail = text.slice(end + 1);
  const pivot = pivotIndex(core);

  return (
    <span className="pivot-word">
      <span>{lead}{core.slice(0, pivot)}</span>
      <span className="pivot">{core[pivot] || ""}</span>
      <span>{core.slice(pivot + 1)}{trail}</span>
    </span>
  );
}

// The word display with tap zones: left = previous sentence, middle = play/pause, right = next sentence.
function Stage({ current, playing, fontSize, pivot, chunkSize, focusLine, dragging, onBack, onToggle, onNext, fill }) {
  return (
    <div className={`stage${dragging ? " drop" : ""}${playing ? "" : " paused"}`}>
      {focusLine && !dragging && <div className="guide" />}
      <div className="word" style={{ fontSize: fill ? `clamp(40px, 12vw, ${Math.round(fontSize * 1.4)}px)` : `clamp(38px, 12vw, ${fontSize}px)` }}>
        {dragging ? "Drop file to add it" : <PivotWord text={current} enabled={pivot && chunkSize === 1} />}
      </div>
      {!dragging && (
        <div className="zones">
          <button className="side" aria-label="Previous sentence" onClick={onBack}>‹</button>
          <button aria-label={playing ? "Pause" : "Play"} onClick={onToggle} />
          <button className="side" aria-label="Next sentence" onClick={onNext}>›</button>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const path = usePath();

  const [docs, setDocs] = useState([]);
  const [docId, setDocId] = useState(null);
  const [text, setText] = useState(SAMPLE_TEXT);
  const [title, setTitle] = useState("Welcome");
  const [index, setIndex] = useState(0);
  const [ready, setReady] = useState(false);

  const [url, setUrl] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [status, setStatus] = useState("");
  const [libraryQuery, setLibraryQuery] = useState("");

  const [wpm, setWpm] = useState(() => Number(store.get("rsvp:wpm")) || 300);
  const [chunkSize, setChunkSize] = useState(() => Number(store.get("rsvp:chunkSize")) || 1);
  const [fontSize, setFontSize] = useState(() => Number(store.get("rsvp:fontSize")) || 64);
  const [theme, setTheme] = useState(initialTheme);
  const [pivot, setPivot] = useState(() => store.get("rsvp:pivot") !== "false");
  const [focusLine, setFocusLine] = useState(() => store.get("rsvp:focusLine") === "true");
  const [playing, setPlaying] = useState(false);
  const [focus, setFocus] = useState(false);
  const [showText, setShowText] = useState(false);
  const [dragging, setDragging] = useState(false);

  const [inboxToken, setInboxToken] = useState(() => store.get("rsvp:inboxToken") || "");
  const [tokenDraft, setTokenDraft] = useState(() => store.get("rsvp:inboxToken") || "");
  const [server, setServer] = useState({ inbox: null, email: "" });

  const words = useMemo(() => getWords(text), [text]);
  const chunks = useMemo(() => makeChunks(words, chunkSize), [words, chunkSize]);
  const maxIndex = Math.max(0, chunks.length - 1);
  const current = chunks[index] || "";
  const progress = chunks.length ? Math.round(((index + 1) / chunks.length) * 100) : 0;
  const minutesLeft = (words.length - index * chunkSize) / wpm;

  const libraryRef = useRef(null);
  const syncingRef = useRef(false);

  // ---------- Settings persistence ----------
  useEffect(() => { store.set("rsvp:wpm", String(wpm)); }, [wpm]);
  useEffect(() => { store.set("rsvp:chunkSize", String(chunkSize)); }, [chunkSize]);
  useEffect(() => { store.set("rsvp:fontSize", String(fontSize)); }, [fontSize]);
  useEffect(() => { store.set("rsvp:pivot", String(pivot)); }, [pivot]);
  useEffect(() => { store.set("rsvp:focusLine", String(focusLine)); }, [focusLine]);
  useEffect(() => { if (docId) store.set("rsvp:currentDoc", docId); }, [docId]);
  useEffect(() => {
    store.set("rsvp:theme", theme);
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#020617" : "#f8fafc");
  }, [theme]);

  useEffect(() => {
    document.title = PAGE_TITLES[path] || APP_NAME;
    if (path !== "/") { setPlaying(false); setFocus(false); }
  }, [path]);

  // ---------- Reading position persistence ----------
  // Positions are stored as a word offset so changing "words per flash" keeps your place.
  const positionRef = useRef({ docId: null, wordIndex: 0, readWords: 0 });
  const saveTimerRef = useRef(null);

  const flushPosition = useCallback(() => {
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = null;
    const { docId: id, wordIndex, readWords } = positionRef.current;
    if (!id) return;
    setDocs((list) => list.map((d) => (d.id === id ? { ...d, wordIndex, readWords } : d)));
    updateDoc(id, { wordIndex, readWords }).catch((error) => console.warn("Could not save position", error));
  }, []);

  useEffect(() => {
    if (!ready || !docId) return;
    positionRef.current = {
      docId,
      wordIndex: index * chunkSize,
      readWords: Math.min(words.length, (index + 1) * chunkSize)
    };
    if (!saveTimerRef.current) saveTimerRef.current = setTimeout(flushPosition, 1500);
  }, [ready, docId, index, chunkSize, words.length, flushPosition]);

  useEffect(() => {
    const onHide = () => { if (document.visibilityState === "hidden") { setPlaying(false); flushPosition(); } };
    window.addEventListener("pagehide", flushPosition);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", flushPosition);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [flushPosition]);

  // ---------- Library ----------
  const refreshDocs = useCallback(async () => {
    const list = await listDocs();
    setDocs(list);
    return list;
  }, []);

  const openDoc = useCallback(async (id, { quiet = false } = {}) => {
    flushPosition();
    const [meta, body] = await Promise.all([getDoc(id), getText(id)]);
    if (!meta) return;
    setPlaying(false);
    setShowText(false);
    setText(body);
    setTitle(meta.title);
    setDocId(id);
    setIndex(Math.floor((meta.wordIndex || 0) / chunkSize));
    positionRef.current = { docId: id, wordIndex: meta.wordIndex || 0, readWords: meta.readWords || 0 };
    await touchDoc(id);
    await refreshDocs();
    if (!quiet) {
      setStatus(meta.wordIndex ? `Resumed "${meta.title}" at ${docProgress(meta)}%.` : `Opened "${meta.title}".`);
    }
    if (window.location.pathname !== "/") navigate("/");
    else window.scrollTo({ top: 0, behavior: "smooth" });
  }, [chunkSize, flushPosition, refreshDocs]);

  const saveAndOpen = useCallback(async ({ text: raw, title: newTitle, source, sourceUrl }) => {
    const clean = normalizeText(raw);
    if (!clean) throw new Error("No readable text found. The file may be copy-protected or image-only.");
    const doc = await addDoc({ title: newTitle || titleFromText(clean), text: clean, source, sourceUrl, wordCount: clean.split(" ").length });
    await openDoc(doc.id, { quiet: true });
    return doc;
  }, [openDoc]);

  // Turns any incoming item (share sheet or inbox) into a library document.
  const importItem = useCallback(async (item, source) => {
    if (item.kind === "file") {
      const parsed = await readDocumentFile(item.blob, setStatus, item.name);
      return await saveAndOpen({ text: parsed.text, title: item.title || parsed.title, source });
    }
    const link = item.kind === "url" ? item.url : sharedUrl(item);
    if (link) {
      setStatus(`Importing ${link}...`);
      try {
        const article = await extractArticle(link);
        return await saveAndOpen({ text: article.text, title: item.title || article.title, source, sourceUrl: link });
      } catch (error) {
        if (getWords(item.text).length > 40) return await saveAndOpen({ text: item.text, title: item.title, source });
        throw error;
      }
    }
    return await saveAndOpen({ text: item.text, title: item.title, source });
  }, [saveAndOpen]);

  // Items handed over by the service worker from the Android share sheet.
  const importPendingShares = useCallback(async () => {
    const pending = await listPendingShares().catch(() => []);
    for (const item of pending) {
      try {
        await importItem(item, "share");
        setStatus("Saved the shared item to your library.");
      } catch (error) {
        setStatus(`Could not read the shared item: ${error.message}`);
      }
      await deletePendingShare(item.id);
    }
    if (new URLSearchParams(window.location.search).has("shared")) {
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, [importItem]);

  // Items sent to the server inbox (iPhone Shortcut, email, or any HTTP client).
  const syncInbox = useCallback(async ({ quiet = false } = {}) => {
    if (!inboxToken || syncingRef.current) return 0;
    syncingRef.current = true;
    const headers = { Authorization: `Bearer ${inboxToken}` };
    let imported = 0;
    try {
      if (!quiet) setStatus("Checking inbox...");
      const response = await fetch("/api/inbox", { headers });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `Inbox returned ${response.status}`);
      for (const item of data.items || []) {
        try {
          const bodyResponse = await fetch(`/api/inbox/${item.id}`, { headers });
          if (!bodyResponse.ok) throw new Error("Could not download it");
          const entry = item.kind === "file"
            ? { ...item, blob: await bodyResponse.blob() }
            : { ...item, ...(await bodyResponse.json()) };
          await importItem(entry, "inbox");
          imported += 1;
          await fetch(`/api/inbox/${item.id}`, { method: "DELETE", headers });
        } catch (error) {
          setStatus(`Could not import "${item.title || item.name || "inbox item"}": ${error.message}`);
        }
      }
      if (imported) setStatus(`Added ${imported} item${imported === 1 ? "" : "s"} from your inbox.`);
      else if (!quiet) setStatus("Inbox is empty.");
    } catch (error) {
      if (!quiet) setStatus(`Inbox: ${error.message}`);
    } finally {
      syncingRef.current = false;
    }
    return imported;
  }, [inboxToken, importItem]);

  // Startup: migrate the old single-document storage, then restore the last document.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const legacyText = store.get("rsvp:text");
        if (legacyText && !legacyText.startsWith("Rapid Serial Visual Presentation, or RSVP")) {
          const clean = normalizeText(legacyText);
          const doc = await addDoc({ title: store.get("rsvp:title") || titleFromText(clean), text: clean, source: "paste", wordCount: clean.split(" ").length });
          const wordIndex = (Number(store.get("rsvp:index")) || 0) * (Number(store.get("rsvp:chunkSize")) || 1);
          await updateDoc(doc.id, { wordIndex, readWords: wordIndex });
          store.set("rsvp:currentDoc", doc.id);
        }
        ["rsvp:text", "rsvp:title", "rsvp:index", "rsvp:dark"].forEach(store.remove);

        const list = await refreshDocs();
        const lastId = store.get("rsvp:currentDoc");
        const target = list.find((d) => d.id === lastId) || list[0];
        if (target && !cancelled) await openDoc(target.id, { quiet: true });
      } catch (error) {
        console.error(error);
        setStatus("Your library isn't available in this browser (private window?). Documents won't be kept.");
      }
      if (cancelled) return;
      setReady(true);
      await importPendingShares();
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fetch("/api/status").then((r) => r.json()).then((d) => setServer({ inbox: Boolean(d.inbox), email: d.email || "" })).catch(() => setServer({ inbox: false, email: "" }));
  }, []);

  // Pull from the inbox on launch and whenever the app comes back to the foreground.
  useEffect(() => {
    if (!ready || !inboxToken) return;
    syncInbox({ quiet: true });
    const onVisible = () => { if (document.visibilityState === "visible") syncInbox({ quiet: true }); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [ready, inboxToken, syncInbox]);

  // ---------- Playback ----------
  useEffect(() => { setIndex((old) => clamp(old, 0, maxIndex)); }, [maxIndex]);

  useEffect(() => {
    if (!playing || !chunks.length) return;
    if (index >= maxIndex) {
      setPlaying(false);
      return;
    }
    const timer = setTimeout(() => setIndex((old) => clamp(old + 1, 0, maxIndex)), delayForChunk(current, wpm));
    return () => clearTimeout(timer);
  }, [playing, index, maxIndex, current, wpm, chunks.length]);

  useEffect(() => { if (!playing) flushPosition(); }, [playing, flushPosition]);

  // Keep the screen awake while words are flashing.
  useEffect(() => {
    if (!playing || !navigator.wakeLock) return;
    let lock;
    navigator.wakeLock.request("screen").then((l) => { lock = l; }).catch(() => {});
    return () => { lock?.release().catch(() => {}); };
  }, [playing]);

  const togglePlay = useCallback(() => {
    if (!playing && index >= maxIndex && maxIndex > 0) setIndex(0); // pressing play at the end starts over
    setPlaying(!playing);
  }, [playing, index, maxIndex]);
  const backSentence = useCallback(() => setIndex((i) => prevSentenceStart(chunks, i)), [chunks]);
  const nextSentence = useCallback(() => setIndex((i) => nextSentenceStart(chunks, i)), [chunks]);

  // ---------- Focus mode ----------
  const wentFullscreen = useRef(false);
  const enterFocus = useCallback(() => {
    setFocus(true);
    const el = document.documentElement;
    if (el.requestFullscreen && !document.fullscreenElement) {
      el.requestFullscreen().then(() => { wentFullscreen.current = true; }).catch(() => {});
    }
  }, []);
  const exitFocus = useCallback(() => {
    setFocus(false);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    wentFullscreen.current = false;
  }, []);
  useEffect(() => {
    const onChange = () => {
      if (!document.fullscreenElement && wentFullscreen.current) { wentFullscreen.current = false; setFocus(false); }
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // ---------- Keyboard ----------
  useEffect(() => {
    if (path !== "/") return undefined;
    function onKeyDown(event) {
      const tag = event.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key;
      if (event.code === "Space") { event.preventDefault(); togglePlay(); }
      else if (key === "ArrowLeft") { event.preventDefault(); event.shiftKey ? backSentence() : setIndex((i) => clamp(i - 1, 0, maxIndex)); }
      else if (key === "ArrowRight") { event.preventDefault(); event.shiftKey ? nextSentence() : setIndex((i) => clamp(i + 1, 0, maxIndex)); }
      else if (key === "ArrowUp") { event.preventDefault(); setWpm((w) => clamp(w + 25, 100, 1000)); }
      else if (key === "ArrowDown") { event.preventDefault(); setWpm((w) => clamp(w - 25, 100, 1000)); }
      else if (key === "f" || key === "F") { focus ? exitFocus() : enterFocus(); }
      else if (key === "Escape" && focus) exitFocus();
      else if (key === "r" || key === "R") { setPlaying(false); setIndex(0); }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [path, maxIndex, focus, togglePlay, backSentence, nextSentence, enterFocus, exitFocus]);

  function changeChunkSize(next) {
    const wordIndex = index * chunkSize;
    setChunkSize(next);
    setIndex(Math.floor(wordIndex / next));
  }

  // ---------- Import actions ----------
  async function handleFile(file) {
    if (!file) return;
    setPlaying(false);
    try {
      const parsed = await readDocumentFile(file, setStatus);
      await saveAndOpen({ text: parsed.text, title: parsed.title, source: "file" });
      setStatus(`Saved "${parsed.title}" to your library.`);
    } catch (error) {
      console.error(error);
      setStatus(`Could not read that file: ${error.message || "unknown error"}`);
    }
  }

  async function importUrl(value = url) {
    const trimmed = value.trim();
    if (!trimmed) return;
    const target = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    setStatus("Importing article...");
    setPlaying(false);
    try {
      const article = await extractArticle(target);
      await saveAndOpen({ text: article.text, title: article.title, source: "url", sourceUrl: target });
      setUrl("");
      setStatus(`Saved "${article.title}" to your library.`);
    } catch (error) {
      setStatus(`Could not import that page (${error.message}). Try copying and pasting the article text instead.`);
    }
  }

  async function savePasted(value = pasteText) {
    const trimmed = value.trim();
    if (!trimmed) return;
    const link = sharedUrl({ text: trimmed });
    if (link) { await importUrl(link); setPasteText(""); return; }
    try {
      await saveAndOpen({ text: trimmed, source: "paste" });
      setPasteText("");
      setStatus("Saved pasted text to your library.");
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function pasteFromClipboard() {
    try {
      const clip = await navigator.clipboard.readText();
      if (!clip.trim()) { setStatus("The clipboard is empty."); return; }
      await savePasted(clip);
    } catch {
      setStatus("Clipboard access was blocked. Long-press the text box and choose Paste instead.");
    }
  }

  async function removeDoc(doc) {
    if (!window.confirm(`Delete "${doc.title}" from your library?`)) return;
    await deleteDoc(doc.id);
    const list = await refreshDocs();
    if (doc.id === docId) {
      positionRef.current = { docId: null, wordIndex: 0, readWords: 0 };
      store.remove("rsvp:currentDoc");
      if (list[0]) await openDoc(list[0].id, { quiet: true });
      else { setDocId(null); setText(SAMPLE_TEXT); setTitle("Welcome"); setIndex(0); }
    }
  }

  // Edits to the open document are saved after a short pause in typing.
  const editTimerRef = useRef(null);
  function editText(value) {
    setText(value);
    if (!docId) return;
    clearTimeout(editTimerRef.current);
    const id = docId;
    editTimerRef.current = setTimeout(() => {
      updateDoc(id, { wordCount: getWords(value).length, chars: value.length }, value).then(refreshDocs);
    }, 800);
  }

  function saveToken() {
    const trimmed = tokenDraft.trim();
    setInboxToken(trimmed);
    if (trimmed) store.set("rsvp:inboxToken", trimmed);
    else store.remove("rsvp:inboxToken");
    setStatus(trimmed ? "Inbox token saved." : "Inbox token removed.");
  }

  function showLibrary() {
    if (window.location.pathname !== "/") navigate("/");
    requestAnimationFrame(() => {
      libraryRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      libraryRef.current?.querySelector("input")?.focus({ preventScroll: true });
    });
  }

  const dragHandlers = {
    onDragEnter: (e) => { if (e.dataTransfer?.types?.includes("Files")) { e.preventDefault(); setDragging(true); } },
    onDragOver: (e) => { if (e.dataTransfer?.types?.includes("Files")) e.preventDefault(); },
    onDragLeave: (e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false); },
    onDrop: (e) => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files?.[0]); }
  };

  const filteredDocs = useMemo(() => {
    const q = libraryQuery.trim().toLowerCase();
    return q ? docs.filter((d) => d.title.toLowerCase().includes(q)) : docs;
  }, [docs, libraryQuery]);

  const stageProps = {
    current, playing, fontSize, pivot, chunkSize, focusLine, dragging,
    onBack: backSentence, onToggle: togglePlay, onNext: nextSentence
  };

  // ---------- Views ----------
  const reader = (
    <section className={`reader-card${dragging ? " dragging" : ""}`} {...dragHandlers} aria-label="Reader">
      <div className="reader-meta">
        <span className="reader-title" title={title}>{title}</span>
        <span>{words.length.toLocaleString()} words · {progress}% · {formatDuration(minutesLeft)} left</span>
      </div>
      <div className="bar"><div style={{ width: `${progress}%` }} /></div>
      <Stage {...stageProps} />
      <div className="transport">
        <button className="btn" onClick={() => { setPlaying(false); setIndex(0); }} title="Back to the beginning (R)" aria-label="Start over"><span className="ico" aria-hidden="true">⏮&#xFE0E;</span><span className="lbl">Start</span></button>
        <button className="btn" onClick={backSentence} title="Previous sentence (Shift+←)" aria-label="Previous sentence"><span className="ico" aria-hidden="true">«</span><span className="lbl">Back</span></button>
        <button className="btn primary" onClick={togglePlay} title="Play or pause (Space)">{playing ? "Pause" : "Play"}</button>
        <button className="btn" onClick={nextSentence} title="Next sentence (Shift+→)" aria-label="Next sentence"><span className="ico" aria-hidden="true">»</span><span className="lbl">Next</span></button>
        <button className="btn" onClick={enterFocus} title="Full-screen reading (F)" aria-label="Focus mode"><span className="ico" aria-hidden="true">⛶</span><span className="lbl">Focus</span></button>
      </div>
      {status && <div className="status" role="status">{status}</div>}
    </section>
  );

  const library = (
    <section ref={libraryRef} className="panel library-area" aria-label="Library" style={{ scrollMarginTop: "calc(var(--nav-h) + 12px)" }}>
      <div className="panel-head">
        <h2>Library <span className="muted small">({docs.length})</span></h2>
        {inboxToken && <button className="btn sm" onClick={() => syncInbox()}>Check inbox</button>}
      </div>
      {docs.length > 4 && <input className="field" type="search" value={libraryQuery} onChange={(e) => setLibraryQuery(e.target.value)} placeholder="Search your library" />}
      {!docs.length && <div className="muted small">Nothing saved yet. Anything you add shows up here with your progress, so you can pick up where you left off.</div>}
      <div className="doc-list">
        {filteredDocs.map((doc) => {
          const pct = docProgress(doc);
          const left = ((doc.wordCount || 0) - (doc.readWords || 0)) / wpm;
          return (
            <div key={doc.id} className={`doc${doc.id === docId ? " current" : ""}`}>
              <button className="doc-open" onClick={() => openDoc(doc.id)} title={doc.title}>
                <div className="doc-title">{doc.title}</div>
                <div className="doc-meta">
                  {pct >= 100 ? "Finished" : `${pct}% · ${formatDuration(left)} left`} · {SOURCE_LABEL[doc.source] || "Saved"} · {formatAgo(doc.lastOpenedAt)}
                </div>
                <div className="bar"><div style={{ width: `${pct}%` }} /></div>
              </button>
              <button aria-label={`Delete ${doc.title}`} className="btn sm ghost" onClick={() => removeDoc(doc)}>✕</button>
            </div>
          );
        })}
        {docs.length > 0 && !filteredDocs.length && <div className="muted small">No matches.</div>}
      </div>
    </section>
  );

  const rest = (
    <div className="rest-area">
      <div className="two-col">
        <section className="panel" aria-label="Add">
          <h2>Add</h2>
          <form className="row" onSubmit={(e) => { e.preventDefault(); importUrl(); }}>
            <input className="field" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Article link" inputMode="url" autoCapitalize="off" autoCorrect="off" />
            <button className="btn primary" type="submit">Import</button>
          </form>
          <label className="btn" style={{ textAlign: "center" }}>
            Choose file (PDF, EPUB, TXT…)
            <input type="file" accept={ACCEPTED_FILES} onChange={(e) => { handleFile(e.target.files?.[0]); e.target.value = ""; }} hidden />
          </label>
          <textarea className="field" value={pasteText} onChange={(e) => setPasteText(e.target.value)} placeholder="Paste text or a link" rows={4} />
          <div className="row">
            <button className="btn primary" onClick={() => savePasted()} disabled={!pasteText.trim()}>Save &amp; read</button>
            {navigator.clipboard?.readText && <button className="btn" onClick={pasteFromClipboard}>Paste from clipboard</button>}
          </div>
          <div className="muted small kbd-only">Tip: you can also drag a file onto the reader.</div>
          {docId && <button className="btn ghost" onClick={() => setShowText((s) => !s)}>{showText ? "Hide text" : "View or edit this document's text"}</button>}
          {showText && <textarea className="field" value={text} onChange={(e) => editText(e.target.value)} rows={10} />}
        </section>

        <section className="panel" aria-label="Settings">
          <h2>Settings</h2>
          <label className="slider">Speed: {wpm} words per minute<input type="range" min="100" max="1000" step="25" value={wpm} onChange={(e) => setWpm(Number(e.target.value))} /></label>
          <label className="slider">Words per flash: {chunkSize}<input type="range" min="1" max="5" step="1" value={chunkSize} onChange={(e) => changeChunkSize(Number(e.target.value))} /></label>
          <label className="slider">Text size: {fontSize}px<input type="range" min="38" max="120" step="2" value={fontSize} onChange={(e) => setFontSize(Number(e.target.value))} /></label>
          <label className="slider">Position: {chunks.length ? index + 1 : 0} of {chunks.length}<input type="range" min="0" max={maxIndex} step="1" value={index} onChange={(e) => setIndex(Number(e.target.value))} /></label>
          <label className="toggle">Pivot letter <input type="checkbox" checked={pivot} disabled={chunkSize !== 1} onChange={(e) => setPivot(e.target.checked)} /></label>
          <label className="toggle">Focus line <input type="checkbox" checked={focusLine} onChange={(e) => setFocusLine(e.target.checked)} /></label>
          <div className="muted small kbd-only">
            <kbd>Space</kbd> play · <kbd>←</kbd><kbd>→</kbd> word · <kbd>Shift</kbd>+<kbd>←</kbd><kbd>→</kbd> sentence · <kbd>↑</kbd><kbd>↓</kbd> speed · <kbd>F</kbd> focus · <Link to="/help#keys">all shortcuts</Link>
          </div>
        </section>
      </div>

      <section className="panel" aria-label="Inbox">
        <div className="panel-head">
          <h2>Inbox</h2>
          <Link to="/help#phone" className="small">How to send from your phone or email</Link>
        </div>
        <div className="muted small">
          On Android, install RAFAS and it appears in the Share menu. iPhone Shortcuts and email go through a private inbox, which needs the inbox token.
          {server.inbox === false && " The inbox isn't switched on for this site yet."}
        </div>
        <form className="row" onSubmit={(e) => { e.preventDefault(); saveToken(); }}>
          <input className="field" type="password" value={tokenDraft} onChange={(e) => setTokenDraft(e.target.value)} placeholder="Inbox token" autoComplete="off" />
          <button className="btn primary" type="submit">Save</button>
        </form>
      </section>
    </div>
  );

  let page;
  if (path === "/") {
    page = <div className="layout"><div className="reader-area">{reader}</div>{library}{rest}</div>;
  } else if (path === "/about") page = <About />;
  else if (path === "/help") page = <Help inboxEmail={server.email || DEFAULT_INBOX_EMAIL} inboxEnabled={server.inbox !== false} hasToken={Boolean(inboxToken)} />;
  else if (path === "/privacy") page = <Privacy />;
  else page = <article className="page"><h1>Page not found</h1><p><Link to="/">Back to reading</Link></p></article>;

  return (
    <>
      <header className="topbar">
        <Link to="/" className="brand" aria-label={`${APP_NAME} home`}>
          <span className="brand-mark">RAF<span>A</span>S</span>
          <span className="brand-tag">{APP_LONG_NAME}</span>
        </Link>
        <nav className="nav" aria-label="Main">
          <button onClick={showLibrary}>Library</button>
          <Link to="/help" aria-current={path === "/help" ? "page" : undefined}>Help</Link>
          <Link to="/about" aria-current={path === "/about" ? "page" : undefined}>About</Link>
          <button onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`} title="Switch theme">
            {theme === "dark" ? "☀" : "☾"}
          </button>
        </nav>
      </header>

      <main className="shell">{page}</main>

      <footer className="footer">
        <span>{APP_NAME} · {APP_LONG_NAME}</span>
        <Link to="/help">Help</Link>
        <Link to="/about">About</Link>
        <Link to="/privacy">Privacy</Link>
      </footer>

      {focus && path === "/" && (
        <div className="focus" role="dialog" aria-label="Focus reading">
          <div className="bar"><div style={{ width: `${progress}%` }} /></div>
          <div className="focus-bar">
            <span>{progress}% · {formatDuration(minutesLeft)} left · {wpm} wpm</span>
            <button className="btn sm" onClick={exitFocus} aria-label="Leave focus mode">✕</button>
          </div>
          <Stage {...stageProps} fill />
        </div>
      )}
    </>
  );
}

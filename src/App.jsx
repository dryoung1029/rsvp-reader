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

const SAMPLE_TEXT = `Rapid Serial Visual Presentation, or RSVP, shows text one word or short phrase at a time in the same location. Paste text, import a URL, drag in a PDF, or load an EPUB. Everything you open is saved to your library with your place in it, so you can come back later and pick up where you left off.`;

const SOURCE_LABEL = { paste: "Pasted", url: "Web", file: "File", share: "Shared", inbox: "Inbox", email: "Email" };

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

function PivotWord({ text, enabled }) {
  if (!text) return <span>Drag a PDF or EPUB here</span>;
  if (!enabled || text.includes(" ")) return <span>{text}</span>;

  const marks = ".,!?;:()[]{}\"'“”‘’";
  let start = 0;
  let end = text.length - 1;
  while (start < text.length && marks.includes(text[start])) start += 1;
  while (end > start && marks.includes(text[end])) end -= 1;

  const lead = text.slice(0, start);
  const core = text.slice(start, end + 1) || text;
  const trail = text.slice(end + 1);
  const pivot = pivotIndex(core);

  return (
    <span style={{ display: "inline-grid", gridTemplateColumns: "1fr auto 1fr", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
      <span style={{ textAlign: "right" }}>{lead}{core.slice(0, pivot)}</span>
      <span style={{ color: "#ef4444" }}>{core[pivot] || ""}</span>
      <span style={{ textAlign: "left" }}>{core.slice(pivot + 1)}{trail}</span>
    </span>
  );
}

export default function App() {
  const [docs, setDocs] = useState([]);
  const [docId, setDocId] = useState(null);
  const [text, setText] = useState(SAMPLE_TEXT);
  const [title, setTitle] = useState("Sample text");
  const [index, setIndex] = useState(0);
  const [ready, setReady] = useState(false);

  const [url, setUrl] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [status, setStatus] = useState("");
  const [libraryQuery, setLibraryQuery] = useState("");

  const [wpm, setWpm] = useState(() => Number(store.get("rsvp:wpm")) || 325);
  const [chunkSize, setChunkSize] = useState(() => Number(store.get("rsvp:chunkSize")) || 1);
  const [fontSize, setFontSize] = useState(() => Number(store.get("rsvp:fontSize")) || 62);
  const [dark, setDark] = useState(() => store.get("rsvp:dark") !== "false");
  const [pivot, setPivot] = useState(() => store.get("rsvp:pivot") !== "false");
  const [focusLine, setFocusLine] = useState(() => store.get("rsvp:focusLine") === "true");
  const [playing, setPlaying] = useState(false);
  const [showText, setShowText] = useState(false);
  const [dragging, setDragging] = useState(false);

  const [inboxToken, setInboxToken] = useState(() => store.get("rsvp:inboxToken") || "");
  const [tokenDraft, setTokenDraft] = useState(() => store.get("rsvp:inboxToken") || "");
  const [serverInbox, setServerInbox] = useState(null);

  const words = useMemo(() => getWords(text), [text]);
  const chunks = useMemo(() => makeChunks(words, chunkSize), [words, chunkSize]);
  const maxIndex = Math.max(0, chunks.length - 1);
  const current = chunks[index] || "";
  const progress = chunks.length ? Math.round(((index + 1) / chunks.length) * 100) : 0;
  const minutesLeft = ((words.length - index * chunkSize) / wpm);

  const libraryRef = useRef(null);
  const syncingRef = useRef(false);

  // ---------- Settings persistence ----------
  useEffect(() => { store.set("rsvp:wpm", String(wpm)); }, [wpm]);
  useEffect(() => { store.set("rsvp:chunkSize", String(chunkSize)); }, [chunkSize]);
  useEffect(() => { store.set("rsvp:fontSize", String(fontSize)); }, [fontSize]);
  useEffect(() => { store.set("rsvp:dark", String(dark)); }, [dark]);
  useEffect(() => { store.set("rsvp:pivot", String(pivot)); }, [pivot]);
  useEffect(() => { store.set("rsvp:focusLine", String(focusLine)); }, [focusLine]);
  useEffect(() => { if (docId) store.set("rsvp:currentDoc", docId); }, [docId]);

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
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [chunkSize, flushPosition, refreshDocs]);

  const saveAndOpen = useCallback(async ({ text: raw, title: newTitle, source, sourceUrl }) => {
    const clean = normalizeText(raw);
    if (!clean) throw new Error("No readable text found. The file may be DRM-protected or image-only.");
    const doc = await addDoc({ title: newTitle || titleFromText(clean), text: clean, source, sourceUrl, wordCount: clean.split(" ").length });
    await openDoc(doc.id, { quiet: true });
    return doc;
  }, [openDoc]);

  // Turns any incoming item (share sheet, inbox, email) into a library document.
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

  // Items handed to us by the service worker from the Android share sheet.
  const importPendingShares = useCallback(async () => {
    const pending = await listPendingShares().catch(() => []);
    let imported = 0;
    for (const item of pending) {
      try {
        await importItem(item, "share");
        imported += 1;
      } catch (error) {
        setStatus(`Could not read shared item: ${error.message}`);
      }
      await deletePendingShare(item.id);
    }
    if (new URLSearchParams(window.location.search).has("shared")) {
      window.history.replaceState(null, "", window.location.pathname);
    }
    return imported;
  }, [importItem]);

  // Items sent to the server inbox (iOS Shortcut, email, or any HTTP client).
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
          let entry = item;
          if (item.kind === "file") {
            const fileResponse = await fetch(`/api/inbox/${item.id}/file`, { headers });
            if (!fileResponse.ok) throw new Error("Could not download file");
            entry = { ...item, blob: await fileResponse.blob() };
          }
          await importItem(entry, "inbox");
          imported += 1;
          await fetch(`/api/inbox/${item.id}`, { method: "DELETE", headers });
        } catch (error) {
          setStatus(`Could not import "${item.title || item.name || "inbox item"}": ${error.message}`);
        }
      }
      if (imported) setStatus(`Imported ${imported} item${imported === 1 ? "" : "s"} from your inbox.`);
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
        if (legacyText && normalizeText(legacyText) !== normalizeText(SAMPLE_TEXT)) {
          const clean = normalizeText(legacyText);
          const doc = await addDoc({ title: store.get("rsvp:title") || titleFromText(clean), text: clean, source: "paste", wordCount: clean.split(" ").length });
          const wordIndex = (Number(store.get("rsvp:index")) || 0) * (Number(store.get("rsvp:chunkSize")) || 1);
          await updateDoc(doc.id, { wordIndex, readWords: wordIndex });
          store.set("rsvp:currentDoc", doc.id);
        }
        ["rsvp:text", "rsvp:title", "rsvp:index"].forEach(store.remove);

        const list = await refreshDocs();
        const lastId = store.get("rsvp:currentDoc");
        const target = list.find((d) => d.id === lastId) || list[0];
        if (target && !cancelled) await openDoc(target.id, { quiet: true });
      } catch (error) {
        console.error(error);
        setStatus("Saved library is unavailable in this browser (private mode?). Documents won't be kept.");
      }
      if (cancelled) return;
      setReady(true);
      await importPendingShares();
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fetch("/api/status").then((r) => r.json()).then((d) => setServerInbox(Boolean(d.inbox))).catch(() => setServerInbox(false));
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

  // Keep the phone screen awake while words are flashing.
  useEffect(() => {
    if (!playing || !navigator.wakeLock) return;
    let lock;
    navigator.wakeLock.request("screen").then((l) => { lock = l; }).catch(() => {});
    return () => { lock?.release().catch(() => {}); };
  }, [playing]);

  useEffect(() => {
    function onKeyDown(event) {
      const tag = event.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "BUTTON") return;
      if (event.code === "Space") { event.preventDefault(); setPlaying((p) => !p); }
      if (event.key === "ArrowLeft") setIndex((i) => clamp(i - 1, 0, maxIndex));
      if (event.key === "ArrowRight") setIndex((i) => clamp(i + 1, 0, maxIndex));
      if (event.key === "r" || event.key === "R") { setPlaying(false); setIndex(0); }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [maxIndex]);

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
    setStatus("Importing article...");
    setPlaying(false);
    try {
      const article = await extractArticle(trimmed);
      await saveAndOpen({ text: article.text, title: article.title, source: "url", sourceUrl: trimmed });
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
      if (!clip.trim()) { setStatus("Clipboard is empty."); return; }
      await savePasted(clip);
    } catch {
      setStatus("Clipboard access was blocked. Long-press the box below and choose Paste instead.");
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
      else { setDocId(null); setText(SAMPLE_TEXT); setTitle("Sample text"); setIndex(0); }
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

  function onDrop(event) {
    event.preventDefault();
    event.stopPropagation();
    setDragging(false);
    handleFile(event.dataTransfer.files?.[0]);
  }

  const filteredDocs = useMemo(() => {
    const q = libraryQuery.trim().toLowerCase();
    return q ? docs.filter((d) => d.title.toLowerCase().includes(q)) : docs;
  }, [docs, libraryQuery]);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const inboxUrl = `${origin}/api/inbox`;
  const emailWebhook = `${origin}/api/inbox/email?token=${encodeURIComponent(inboxToken || "YOUR_TOKEN")}`;

  // ---------- Styles ----------
  const c = dark ? {
    page: "#020617", text: "#f8fafc", panel: "#0f172a", panel2: "#111827", border: "#334155", muted: "#94a3b8", input: "#020617", active: "rgba(239,68,68,.14)"
  } : {
    page: "#f8fafc", text: "#0f172a", panel: "#ffffff", panel2: "#e2e8f0", border: "#cbd5e1", muted: "#475569", input: "#ffffff", active: "rgba(239,68,68,.10)"
  };

  const button = { font: "inherit", fontWeight: 800, border: `1px solid ${c.border}`, background: c.panel2, color: c.text, borderRadius: 14, padding: "12px 14px", cursor: "pointer" };
  const small = { ...button, padding: "8px 10px", borderRadius: 10, fontSize: 14 };
  const primary = { ...button, background: "#ef4444", borderColor: "#ef4444", color: "white", minWidth: 96 };
  const input = { font: "inherit", fontSize: 16, width: "100%", boxSizing: "border-box", border: `1px solid ${c.border}`, background: c.input, color: c.text, borderRadius: 14, padding: 13 };
  const panel = { background: c.panel, border: `1px solid ${c.border}`, borderRadius: 24, padding: 16, display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 12, alignContent: "start", minWidth: 0 };
  const code = { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 13, background: c.panel2, border: `1px solid ${c.border}`, borderRadius: 8, padding: "2px 6px", wordBreak: "break-all" };

  return (
    <div style={{ minHeight: "100vh", background: c.page, color: c.text, fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif", padding: "env(safe-area-inset-top) 14px calc(24px + env(safe-area-inset-bottom))", boxSizing: "border-box" }}>
      <main style={{ maxWidth: 1040, margin: "0 auto", display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 16 }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap", paddingTop: 18 }}>
          <div>
            <div style={{ color: c.muted, fontSize: 13, fontWeight: 900, letterSpacing: 1, textTransform: "uppercase" }}>RSVP Reader</div>
            <h1 style={{ margin: "6px 0 4px", fontSize: "clamp(30px, 8vw, 54px)", lineHeight: 0.98 }}>Read faster. Blink responsibly.</h1>
            <div style={{ color: c.muted, lineHeight: 1.45 }}>PDF, EPUB, TXT, MD, HTML, web articles, or pasted text. Everything is saved with your place in it.</div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button style={button} onClick={() => libraryRef.current?.scrollIntoView({ behavior: "smooth" })}>Library ({docs.length})</button>
            <button style={button} onClick={() => setDark((d) => !d)}>{dark ? "Light" : "Dark"}</button>
          </div>
        </header>

        <section
          onDragEnter={(e) => { e.preventDefault(); setDragging(true); }}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={(e) => { e.preventDefault(); setDragging(false); }}
          onDrop={onDrop}
          style={{ background: c.panel, border: `2px dashed ${dragging ? "#ef4444" : c.border}`, borderRadius: 26, padding: 16, boxShadow: "0 20px 50px rgba(0,0,0,.20)", transition: "border-color 120ms ease, transform 120ms ease", transform: dragging ? "scale(1.01)" : "scale(1)" }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", color: c.muted, fontSize: 14, marginBottom: 10 }}>
            <span style={{ fontWeight: 700, color: c.text, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{title}</span>
            <span>{words.length.toLocaleString()} words · {progress}% · {formatDuration(minutesLeft)} left</span>
          </div>
          <div style={{ height: 9, background: c.panel2, borderRadius: 999, overflow: "hidden", marginBottom: 16 }}>
            <div style={{ height: "100%", width: `${progress}%`, background: "#ef4444", transition: "width 120ms linear" }} />
          </div>
          <div onClick={() => setPlaying((p) => !p)} style={{ position: "relative", minHeight: "min(46vh, 390px)", display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", border: `1px solid ${dragging ? "#ef4444" : c.border}`, borderRadius: 24, background: dragging ? "rgba(239,68,68,.12)" : c.input, padding: 18, userSelect: "none", cursor: "pointer", overflow: "hidden" }}>
            {focusLine && !dragging && <div style={{ position: "absolute", left: "50%", top: 16, bottom: 16, width: 1, background: dark ? "rgba(255,255,255,.65)" : "rgba(15,23,42,.38)", transform: "translateX(-50%)", pointerEvents: "none" }} />}
            <div style={{ position: "relative", zIndex: 1, fontSize: `clamp(38px, 13vw, ${fontSize}px)`, fontWeight: 900, lineHeight: 1.08, maxWidth: "100%", wordBreak: "break-word" }}>
              {dragging ? "Drop file to load" : <PivotWord text={current} enabled={pivot && chunkSize === 1} />}
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginTop: 14 }}>
            <button style={button} onClick={() => { setPlaying(false); setIndex(0); }}>Restart</button>
            <button style={button} onClick={() => setIndex((i) => clamp(i - 10, 0, maxIndex))}>-10</button>
            <button style={primary} onClick={() => setPlaying((p) => !p)}>{playing ? "Pause" : "Play"}</button>
            <button style={button} onClick={() => setIndex((i) => clamp(i + 10, 0, maxIndex))}>+10</button>
          </div>
          {status && <div role="status" style={{ color: c.muted, fontSize: 14, marginTop: 12 }}>{status}</div>}
        </section>

        <section ref={libraryRef} style={{ ...panel, scrollMarginTop: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <h2 style={{ margin: 0 }}>Library</h2>
            {inboxToken && <button style={small} onClick={() => syncInbox()}>Check inbox</button>}
          </div>
          {docs.length > 5 && <input value={libraryQuery} onChange={(e) => setLibraryQuery(e.target.value)} placeholder="Search your library" style={input} />}
          {!docs.length && <div style={{ color: c.muted }}>Nothing saved yet. Import a file, a URL, or pasted text and it will show up here with your progress.</div>}
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 8 }}>
            {filteredDocs.map((doc) => {
              const pct = docProgress(doc);
              const left = ((doc.wordCount || 0) - (doc.readWords || 0)) / wpm;
              const isCurrent = doc.id === docId;
              return (
                <div key={doc.id} style={{ display: "flex", alignItems: "center", gap: 10, border: `1px solid ${isCurrent ? "#ef4444" : c.border}`, background: isCurrent ? c.active : c.panel2, borderRadius: 16, padding: 10 }}>
                  <button onClick={() => openDoc(doc.id)} style={{ flex: 1, minWidth: 0, textAlign: "left", background: "none", border: "none", color: c.text, padding: 0, cursor: "pointer", font: "inherit" }}>
                    <div style={{ fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{doc.title}</div>
                    <div style={{ color: c.muted, fontSize: 13, marginTop: 3 }}>
                      {pct >= 100 ? "Finished" : `${pct}% · ${formatDuration(left)} left`} · {(doc.wordCount || 0).toLocaleString()} words · {SOURCE_LABEL[doc.source] || "Saved"} · {formatAgo(doc.lastOpenedAt)}
                    </div>
                    <div style={{ height: 4, background: c.border, borderRadius: 999, overflow: "hidden", marginTop: 6 }}>
                      <div style={{ height: "100%", width: `${pct}%`, background: "#ef4444" }} />
                    </div>
                  </button>
                  <button aria-label={`Delete ${doc.title}`} style={{ ...small, background: "transparent" }} onClick={() => removeDoc(doc)}>✕</button>
                </div>
              );
            })}
          </div>
        </section>

        <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(285px, 1fr))", gap: 16 }}>
          <div style={panel}>
            <h2 style={{ margin: 0 }}>Import</h2>
            <div style={{ display: "flex", gap: 8 }}>
              <input value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") importUrl(); }} placeholder="Paste article URL" inputMode="url" style={input} />
              <button style={primary} onClick={() => importUrl()}>Import</button>
            </div>
            <input type="file" accept={ACCEPTED_FILES} onChange={(e) => { handleFile(e.target.files?.[0]); e.target.value = ""; }} style={{ color: c.muted }} />
            <textarea value={pasteText} onChange={(e) => setPasteText(e.target.value)} placeholder="Paste text or a link here" style={{ ...input, minHeight: 110, lineHeight: 1.5, resize: "vertical" }} />
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button style={primary} onClick={() => savePasted()} disabled={!pasteText.trim()}>Save &amp; read</button>
              {navigator.clipboard?.readText && <button style={button} onClick={pasteFromClipboard}>Paste from clipboard</button>}
            </div>
            {docId && <button style={button} onClick={() => setShowText((s) => !s)}>{showText ? "Hide text" : "View/edit current text"}</button>}
            {showText && <textarea value={text} onChange={(e) => editText(e.target.value)} style={{ ...input, minHeight: 230, lineHeight: 1.5, resize: "vertical" }} />}
          </div>

          <div style={{ ...panel, gap: 14 }}>
            <h2 style={{ margin: 0 }}>Controls</h2>
            <label style={{ color: c.muted }}>Speed: {wpm} WPM<input type="range" min="100" max="900" step="25" value={wpm} onChange={(e) => setWpm(Number(e.target.value))} style={{ width: "100%" }} /></label>
            <label style={{ color: c.muted }}>Words per flash: {chunkSize}<input type="range" min="1" max="5" step="1" value={chunkSize} onChange={(e) => changeChunkSize(Number(e.target.value))} style={{ width: "100%" }} /></label>
            <label style={{ color: c.muted }}>Font size: {fontSize}px<input type="range" min="38" max="110" step="2" value={fontSize} onChange={(e) => setFontSize(Number(e.target.value))} style={{ width: "100%" }} /></label>
            <label style={{ color: c.muted }}>Position: {chunks.length ? index + 1 : 0} / {chunks.length}<input type="range" min="0" max={maxIndex} step="1" value={index} onChange={(e) => setIndex(Number(e.target.value))} style={{ width: "100%" }} /></label>
            <label style={{ display: "flex", justifyContent: "space-between", color: c.muted }}>Pivot letter <input type="checkbox" checked={pivot} disabled={chunkSize !== 1} onChange={(e) => setPivot(e.target.checked)} /></label>
            <label style={{ display: "flex", justifyContent: "space-between", color: c.muted }}>Focus line <input type="checkbox" checked={focusLine} onChange={(e) => setFocusLine(e.target.checked)} /></label>
            <div style={{ color: c.muted, fontSize: 14 }}>Keyboard: Space play/pause, ← → step, R restart.</div>
          </div>
        </section>

        <section style={panel}>
          <h2 style={{ margin: 0 }}>Send to reader</h2>
          <details>
            <summary style={{ cursor: "pointer", fontWeight: 800 }}>Android: share sheet</summary>
            <div style={{ color: c.muted, lineHeight: 1.5, marginTop: 8 }}>
              In Chrome, open the menu and choose <b>Add to Home screen</b> (or <b>Install app</b>). After that, <b>RSVP</b> appears in the Share menu of any app. Share a web page, selected text, or a PDF/EPUB file and it opens here, saved to your library.
            </div>
          </details>

          <div style={{ color: c.muted, lineHeight: 1.5 }}>
            iPhone and email sending go through a private inbox on your server.{" "}
            {serverInbox === false && <b>The inbox is off: set the INBOX_TOKEN variable on the server to turn it on.</b>}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <input type="password" value={tokenDraft} onChange={(e) => setTokenDraft(e.target.value)} placeholder="Inbox token (same as INBOX_TOKEN)" autoComplete="off" style={input} />
            <button style={primary} onClick={saveToken}>Save</button>
          </div>

          <details>
            <summary style={{ cursor: "pointer", fontWeight: 800 }}>iPhone / iPad: Shortcut</summary>
            <ol style={{ color: c.muted, lineHeight: 1.6, paddingLeft: 20, marginBottom: 0 }}>
              <li>Open Shortcuts, tap <b>+</b>, then tap the <b>ⓘ</b> button and turn on <b>Show in Share Sheet</b>. Set it to receive Files, Text, URLs, Safari web pages and PDFs.</li>
              <li>Add <b>Get Contents of URL</b>. URL: <span style={code}>{inboxUrl}</span></li>
              <li>Tap <b>Show More</b>: Method <b>POST</b>, add header <span style={code}>Authorization</span> = <span style={code}>Bearer {inboxToken ? "•••• (your token)" : "YOUR_TOKEN"}</span>.</li>
              <li>Request Body <b>Form</b>: add a <b>File</b> field named <span style={code}>file</span> set to <b>Shortcut Input</b>. For links or text, add a <b>Text</b> field named <span style={code}>text</span> instead.</li>
              <li>Name it "Send to RSVP". Share anything to it, then open this app: it pulls the inbox automatically.</li>
            </ol>
          </details>

          <details>
            <summary style={{ cursor: "pointer", fontWeight: 800 }}>Email</summary>
            <div style={{ color: c.muted, lineHeight: 1.6, marginTop: 8 }}>
              Set up an inbound email service (Postmark Inbound, SendGrid Inbound Parse, or Mailgun Routes) on an address you control, and point its webhook at:
              <div style={{ margin: "8px 0", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span style={code}>{inboxToken ? emailWebhook.replace(encodeURIComponent(inboxToken), "••••") : emailWebhook}</span>
                {inboxToken && navigator.clipboard?.writeText && <button style={small} onClick={() => navigator.clipboard.writeText(emailWebhook).then(() => setStatus("Webhook URL copied."))}>Copy</button>}
              </div>
              Then email or forward anything to that address. PDF, EPUB, TXT and HTML attachments are imported as documents. An email that is just a link imports the article. Otherwise the email body is imported as text.
            </div>
          </details>
        </section>
      </main>
    </div>
  );
}

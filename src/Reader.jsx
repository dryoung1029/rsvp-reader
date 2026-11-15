import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  clamp, normalizeText, getWords, makeChunks, delayForChunk, pivotIndex,
  firstUrl, formatDuration, formatAgo
} from "./lib/text.js";
import { readDocumentFile, ACCEPTED_FILES } from "./lib/parsers.js";
import {
  listDocs, getDoc, getText, addDoc, updateDoc, putDoc, takeLegacyDocs,
  listPendingShares, deletePendingShare
} from "./lib/library.js";
import { syncLibrary, uploadDoc, downloadText, pushPosition, deleteEverywhere, uploadEditedText } from "./lib/sync.js";
import { chooseFromDropbox, chooseFromGoogleDrive } from "./lib/cloud.js";
import { api } from "./lib/api.js";
import { Link } from "./router.jsx";

const SAMPLE_TEXT = `Welcome to RAFAS. Words appear one at a time in the same spot, so your eyes can stay still. The red letter is the pivot: rest your eyes on it. Tap the middle to pause, or tap the left or right edge to jump back or forward a sentence. Add an article, a PDF, an EPUB, a Word document or some pasted text, and RAFAS will save it to your library and remember your place on every device you sign in on.`;

const SOURCE_LABEL = { paste: "Pasted", url: "Web", link: "Link", file: "File", share: "Shared", inbox: "Inbox", drive: "Google Drive", dropbox: "Dropbox" };
const PUSH_INTERVAL_MS = 8000;

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

// A share or email that is mostly just a link should be read as that link.
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

// Fetches a link through the server. Web pages come back as article text;
// share links to files (Google Drive, Dropbox, OneDrive) come back as the file.
async function importLink(link, setStatus) {
  const response = await fetch("/api/import", {
    method: "POST",
    headers: { "content-type": "application/json", "x-rafas": "1" },
    body: JSON.stringify({ url: link })
  }).catch(() => { throw new Error("You appear to be offline."); });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `Import failed (${response.status})`);
  }
  if (response.headers.get("x-rafas-kind") === "file") {
    const name = decodeURIComponent(response.headers.get("x-rafas-filename") || "document");
    return { ...(await readDocumentFile(await response.blob(), setStatus, name)), kind: "file" };
  }
  const data = await response.json();
  const text = normalizeText(data.text || "");
  if (!text) throw new Error("No readable text found at that link.");
  return { text, title: data.title || link, kind: "article" };
}

export default function Reader({ user, config, visible }) {
  const [docs, setDocs] = useState([]);
  const [docId, setDocId] = useState(null);
  const [text, setText] = useState(SAMPLE_TEXT);
  const [title, setTitle] = useState("Welcome");
  const [index, setIndex] = useState(0);
  const [ready, setReady] = useState(false);

  const [url, setUrl] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [libraryQuery, setLibraryQuery] = useState("");

  const [wpm, setWpm] = useState(() => Number(store.get("rsvp:wpm")) || 300);
  const [chunkSize, setChunkSize] = useState(() => Number(store.get("rsvp:chunkSize")) || 1);
  const [fontSize, setFontSize] = useState(() => Number(store.get("rsvp:fontSize")) || 64);
  const [pivot, setPivot] = useState(() => store.get("rsvp:pivot") !== "false");
  const [focusLine, setFocusLine] = useState(() => store.get("rsvp:focusLine") === "true");
  const [playing, setPlaying] = useState(false);
  const [focus, setFocus] = useState(false);
  const [showText, setShowText] = useState(false);
  const [dragging, setDragging] = useState(false);

  const words = useMemo(() => getWords(text), [text]);
  const chunks = useMemo(() => makeChunks(words, chunkSize), [words, chunkSize]);
  const maxIndex = Math.max(0, chunks.length - 1);
  const current = chunks[index] || "";
  const progress = chunks.length ? Math.round(((index + 1) / chunks.length) * 100) : 0;
  const minutesLeft = (words.length - index * chunkSize) / wpm;

  const libraryRef = useRef(null);
  const syncingRef = useRef(false);
  const inboxSyncingRef = useRef(false);
  const docIdRef = useRef(null);
  const playingRef = useRef(false);
  useEffect(() => { docIdRef.current = docId; }, [docId]);
  useEffect(() => { playingRef.current = playing; }, [playing]);

  const lastDocKey = `rafas:currentDoc:${user.id}`;

  // ---------- Settings persistence ----------
  useEffect(() => { store.set("rsvp:wpm", String(wpm)); }, [wpm]);
  useEffect(() => { store.set("rsvp:chunkSize", String(chunkSize)); }, [chunkSize]);
  useEffect(() => { store.set("rsvp:fontSize", String(fontSize)); }, [fontSize]);
  useEffect(() => { store.set("rsvp:pivot", String(pivot)); }, [pivot]);
  useEffect(() => { store.set("rsvp:focusLine", String(focusLine)); }, [focusLine]);
  useEffect(() => { if (docId) store.set(lastDocKey, docId); }, [docId, lastDocKey]);
  useEffect(() => { if (!visible) { setPlaying(false); setFocus(false); } }, [visible]);

  // ---------- Reading position ----------
  // Saved locally every 1.5s while reading, and sent to the server at most every
  // few seconds, plus whenever you pause or leave. Stored as a word offset so
  // changing "words per flash" keeps your place.
  const positionRef = useRef({ docId: null, wordIndex: 0, readWords: 0 });
  const savedRef = useRef({ docId: null, wordIndex: -1 });
  const saveTimerRef = useRef(null);
  const pushTimerRef = useRef(null);
  const lastPushRef = useRef(0);

  const pushNow = useCallback(async ({ keepalive = false } = {}) => {
    clearTimeout(pushTimerRef.current);
    pushTimerRef.current = null;
    lastPushRef.current = Date.now();
    const id = positionRef.current.docId;
    if (!id) return;
    const doc = await getDoc(id).catch(() => null);
    if (doc) await pushPosition(doc, { keepalive }).catch(() => {});
  }, []);

  const schedulePush = useCallback(() => {
    if (pushTimerRef.current) return;
    const wait = Math.max(0, PUSH_INTERVAL_MS - (Date.now() - lastPushRef.current));
    pushTimerRef.current = setTimeout(() => pushNow(), wait);
  }, [pushNow]);

  const flushPosition = useCallback(async ({ push = false, keepalive = false } = {}) => {
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = null;
    const { docId: id, wordIndex, readWords } = positionRef.current;
    if (!id) return;
    if (savedRef.current.docId !== id || savedRef.current.wordIndex !== wordIndex) {
      savedRef.current = { docId: id, wordIndex };
      const positionAt = Date.now();
      setDocs((list) => list.map((d) => (d.id === id ? { ...d, wordIndex, readWords, positionAt } : d)));
      await updateDoc(id, { wordIndex, readWords, positionAt }).catch((error) => console.warn("Could not save position", error));
    }
    if (push) await pushNow({ keepalive });
    else schedulePush();
  }, [pushNow, schedulePush]);

  useEffect(() => {
    if (!ready || !docId) return;
    positionRef.current = { docId, wordIndex: index * chunkSize, readWords: Math.min(words.length, (index + 1) * chunkSize) };
    if (!saveTimerRef.current) saveTimerRef.current = setTimeout(() => flushPosition(), 1500);
  }, [ready, docId, index, chunkSize, words.length, flushPosition]);

  useEffect(() => { if (!playing && ready) flushPosition({ push: true }); }, [playing, ready, flushPosition]);

  // ---------- Library ----------
  const refreshDocs = useCallback(async () => {
    const list = await listDocs();
    setDocs(list);
    return list;
  }, []);

  const loadIntoReader = useCallback((meta, body) => {
    setPlaying(false);
    setShowText(false);
    setText(body);
    setTitle(meta.title);
    setDocId(meta.id);
    setIndex(Math.floor((meta.wordIndex || 0) / chunkSize));
    positionRef.current = { docId: meta.id, wordIndex: meta.wordIndex || 0, readWords: meta.readWords || 0 };
    savedRef.current = { docId: meta.id, wordIndex: meta.wordIndex || 0 };
  }, [chunkSize]);

  const openDoc = useCallback(async (id, { quiet = false } = {}) => {
    await flushPosition({ push: true });
    const meta = await getDoc(id);
    if (!meta) return;
    let body = await getText(id);
    if (typeof body !== "string" || meta.textMissing) {
      setStatus(`Downloading "${meta.title}"...`);
      try {
        body = await downloadText(id);
      } catch (error) {
        setStatus(`Couldn't download "${meta.title}": ${error.message}`);
        if (typeof body !== "string") return;
      }
    }
    loadIntoReader(meta, body);
    const lastOpenedAt = Date.now();
    await updateDoc(id, { lastOpenedAt });
    if (meta.synced) api(`/api/docs/${id}`, { method: "PATCH", body: { lastOpenedAt } }).catch(() => {});
    await refreshDocs();
    if (!quiet) setStatus(meta.wordIndex ? `Resumed "${meta.title}" at ${docProgress(meta)}%.` : `Opened "${meta.title}".`);
    if (!quiet) window.scrollTo({ top: 0, behavior: "smooth" });
  }, [flushPosition, loadIntoReader, refreshDocs]);

  const saveAndOpen = useCallback(async ({ text: raw, title: newTitle, source, sourceUrl }) => {
    const clean = normalizeText(raw);
    if (!clean) throw new Error("No readable text found. The file may be copy-protected or image-only.");
    const doc = await addDoc({ title: newTitle || titleFromText(clean), text: clean, source, sourceUrl, wordCount: clean.split(" ").length });
    await openDoc(doc.id, { quiet: true });
    if (!doc.synced) uploadDoc(doc).then(refreshDocs).catch((error) => console.warn("Upload will retry on next sync", error));
    return doc;
  }, [openDoc, refreshDocs]);

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
        const result = await importLink(link, setStatus);
        return await saveAndOpen({ text: result.text, title: item.title || result.title, source, sourceUrl: link });
      } catch (error) {
        if (getWords(item.text).length > 40) return await saveAndOpen({ text: item.text, title: item.title, source });
        throw error;
      }
    }
    return await saveAndOpen({ text: item.text, title: item.title, source });
  }, [saveAndOpen]);

  const importPendingShares = useCallback(async () => {
    const pending = await listPendingShares().catch(() => []);
    for (const item of pending) {
      try {
        await importItem(item, "share");
        setStatus("Saved the shared item to your library.");
      } catch (error) {
        setStatus(`Couldn't read the shared item: ${error.message}`);
      }
      await deletePendingShare(item.id);
    }
    if (new URLSearchParams(window.location.search).has("shared")) window.history.replaceState(null, "", "/");
  }, [importItem]);

  // Items sent by email or the iPhone Shortcut wait in the server inbox.
  const syncInbox = useCallback(async ({ quiet = true } = {}) => {
    if (inboxSyncingRef.current || !config?.inbox) return;
    inboxSyncingRef.current = true;
    let imported = 0;
    try {
      const { items } = await api("/api/inbox");
      for (const item of items) {
        try {
          const response = await api(`/api/inbox/${item.id}`, { raw: true });
          const entry = item.kind === "file" ? { ...item, blob: await response.blob() } : { ...item, ...(await response.json()) };
          await importItem(entry, "inbox");
          imported += 1;
          await api(`/api/inbox/${item.id}`, { method: "DELETE" });
        } catch (error) {
          setStatus(`Couldn't import "${item.title || item.name || "inbox item"}": ${error.message}`);
        }
      }
      if (imported) setStatus(`Added ${imported} item${imported === 1 ? "" : "s"} from your inbox.`);
      else if (!quiet) setStatus("Nothing new in your inbox.");
    } catch (error) {
      if (!quiet) setStatus(`Inbox: ${error.message}`);
    } finally {
      inboxSyncingRef.current = false;
    }
  }, [config, importItem]);

  // Pull changes from other devices. If the open document was read elsewhere
  // more recently, jump to that spot (unless you're in the middle of reading).
  const runSync = useCallback(async ({ quiet = true } = {}) => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    try {
      await flushPosition({ push: true });
      const { changedIds } = await syncLibrary();
      const list = await refreshDocs();
      const openId = docIdRef.current;
      if (openId && changedIds.includes(openId) && !playingRef.current) {
        const meta = list.find((d) => d.id === openId);
        if (!meta) {
          setDocId(null); setText(SAMPLE_TEXT); setTitle("Welcome"); setIndex(0);
          positionRef.current = { docId: null, wordIndex: 0, readWords: 0 };
        } else {
          const body = meta.textMissing ? await downloadText(openId) : await getText(openId);
          if (typeof body === "string") {
            loadIntoReader(meta, body);
            setStatus(`Picked up where you left off on another device (${docProgress(meta)}%).`);
          }
        }
      } else if (!openId && list[0]) {
        await openDoc(list[0].id, { quiet: true });
      }
      if (!quiet) setStatus("Library is up to date.");
    } catch (error) {
      if (!quiet || error.status !== 0) console.warn("Sync failed", error);
      if (!quiet) setStatus(`Sync: ${error.message}`);
    } finally {
      syncingRef.current = false;
    }
  }, [flushPosition, refreshDocs, loadIntoReader, openDoc]);

  // Startup: hand over any pre-account documents, open the last document from
  // the local copy straight away, then sync and check the inbox.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const legacy = await takeLegacyDocs().catch(() => []);
        for (const { doc, text: body } of legacy) {
          await putDoc({ ...doc, positionAt: Date.now(), serverPositionAt: 0, synced: false, textMissing: false, textVersion: 1 }, body);
        }
        if (legacy.length) setStatus(`Moved ${legacy.length} document${legacy.length === 1 ? "" : "s"} from this device into your account.`);
        const list = await refreshDocs();
        const lastId = store.get(lastDocKey);
        const target = list.find((d) => d.id === lastId) || list[0];
        if (target && !cancelled) await openDoc(target.id, { quiet: true });
      } catch (error) {
        console.error(error);
        setStatus("This browser can't store your library (private window?). It will download each time.");
      }
      if (cancelled) return;
      setReady(true);
      await importPendingShares();
      await runSync();
      await syncInbox();
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!ready) return undefined;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        setPlaying(false);
        flushPosition({ push: true, keepalive: true });
      } else {
        runSync();
        syncInbox();
      }
    };
    const onPageHide = () => flushPosition({ push: true, keepalive: true });
    const onOnline = () => runSync();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("online", onOnline);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("online", onOnline);
    };
  }, [ready, flushPosition, runSync, syncInbox]);

  useEffect(() => {
    const show = () => requestAnimationFrame(() => {
      libraryRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      libraryRef.current?.querySelector("input")?.focus({ preventScroll: true });
    });
    window.addEventListener("rafas:show-library", show);
    return () => window.removeEventListener("rafas:show-library", show);
  }, []);

  // ---------- Playback ----------
  useEffect(() => { setIndex((old) => clamp(old, 0, maxIndex)); }, [maxIndex]);

  useEffect(() => {
    if (!playing || !chunks.length) return undefined;
    if (index >= maxIndex) {
      setPlaying(false);
      return undefined;
    }
    const timer = setTimeout(() => setIndex((old) => clamp(old + 1, 0, maxIndex)), delayForChunk(current, wpm));
    return () => clearTimeout(timer);
  }, [playing, index, maxIndex, current, wpm, chunks.length]);

  // Keep the screen awake while words are flashing.
  useEffect(() => {
    if (!playing || !navigator.wakeLock) return undefined;
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
    if (!visible) return undefined;
    function onKeyDown(event) {
      const tag = event.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key;
      if (event.code === "Space") { event.preventDefault(); togglePlay(); }
      else if (key === "ArrowLeft") { event.preventDefault(); if (event.shiftKey) backSentence(); else setIndex((i) => clamp(i - 1, 0, maxIndex)); }
      else if (key === "ArrowRight") { event.preventDefault(); if (event.shiftKey) nextSentence(); else setIndex((i) => clamp(i + 1, 0, maxIndex)); }
      else if (key === "ArrowUp") { event.preventDefault(); setWpm((w) => clamp(w + 25, 100, 1000)); }
      else if (key === "ArrowDown") { event.preventDefault(); setWpm((w) => clamp(w - 25, 100, 1000)); }
      else if (key === "f" || key === "F") { if (focus) exitFocus(); else enterFocus(); }
      else if (key === "Escape" && focus) exitFocus();
      else if (key === "r" || key === "R") { setPlaying(false); setIndex(0); }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [visible, maxIndex, focus, togglePlay, backSentence, nextSentence, enterFocus, exitFocus]);

  function changeChunkSize(next) {
    const wordIndex = index * chunkSize;
    setChunkSize(next);
    setIndex(Math.floor(wordIndex / next));
  }

  // ---------- Import actions ----------
  async function run(task) {
    setPlaying(false);
    setBusy(true);
    try { await task(); } catch (error) {
      console.error(error);
      setStatus(error.message || "Something went wrong.");
    } finally { setBusy(false); }
  }

  const handleFile = (file) => file && run(async () => {
    const parsed = await readDocumentFile(file, setStatus);
    await saveAndOpen({ text: parsed.text, title: parsed.title, source: "file" });
    setStatus(`Saved "${parsed.title}" to your library.`);
  });

  const importUrl = (value = url) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    const target = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    run(async () => {
      setStatus("Importing...");
      try {
        const result = await importLink(target, setStatus);
        await saveAndOpen({ text: result.text, title: result.title, source: result.kind === "file" ? "link" : "url", sourceUrl: target });
        setUrl("");
        setStatus(`Saved "${result.title}" to your library.`);
      } catch (error) {
        throw new Error(`Couldn't import that link. ${error.message} You can also copy the text and paste it below.`);
      }
    });
  };

  const savePasted = (value = pasteText) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    const link = sharedUrl({ text: trimmed });
    if (link) { setPasteText(""); importUrl(link); return; }
    run(async () => {
      await saveAndOpen({ text: trimmed, source: "paste" });
      setPasteText("");
      setStatus("Saved pasted text to your library.");
    });
  };

  async function pasteFromClipboard() {
    try {
      const clip = await navigator.clipboard.readText();
      if (!clip.trim()) { setStatus("The clipboard is empty."); return; }
      savePasted(clip);
    } catch {
      setStatus("Clipboard access was blocked. Long-press the text box and choose Paste instead.");
    }
  }

  const pickDropbox = () => run(async () => {
    const picked = await chooseFromDropbox(config.dropbox.appKey);
    if (!picked) return;
    setStatus(`Downloading ${picked.name}...`);
    let parsed;
    try {
      const response = await fetch(picked.url);
      if (!response.ok) throw new Error(String(response.status));
      parsed = await readDocumentFile(await response.blob(), setStatus, picked.name);
    } catch {
      parsed = await importLink(picked.url, setStatus); // fall back to fetching through the server
    }
    await saveAndOpen({ text: parsed.text, title: parsed.title || picked.name, source: "dropbox" });
    setStatus(`Saved "${parsed.title || picked.name}" from Dropbox.`);
  });

  const pickGoogle = () => run(async () => {
    const picked = await chooseFromGoogleDrive(config.google);
    if (!picked) return;
    const parsed = await readDocumentFile(picked.blob, setStatus, picked.name);
    await saveAndOpen({ text: parsed.text, title: picked.title || parsed.title, source: "drive" });
    setStatus(`Saved "${picked.title}" from Google Drive.`);
  });

  async function removeDocument(doc) {
    if (!window.confirm(`Delete "${doc.title}" from your library on all your devices?`)) return;
    if (doc.id === docId) positionRef.current = { docId: null, wordIndex: 0, readWords: 0 };
    await deleteEverywhere(doc.id);
    const list = await refreshDocs();
    if (doc.id === docId) {
      store.remove(lastDocKey);
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
    editTimerRef.current = setTimeout(async () => {
      const wordCount = getWords(value).length;
      const doc = await updateDoc(id, { wordCount, chars: value.length }, value);
      await refreshDocs();
      if (doc?.synced) uploadEditedText(id, value, wordCount).catch((error) => setStatus(`Edit saved on this device only: ${error.message}`));
    }, 1200);
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

  if (!visible) return null;

  const stageProps = {
    current, playing, fontSize, pivot, chunkSize, focusLine, dragging,
    onBack: backSentence, onToggle: togglePlay, onNext: nextSentence
  };

  return (
    <>
      <div className="layout">
        <div className="reader-area">
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
        </div>

        <section ref={libraryRef} className="panel library-area" aria-label="Library" style={{ scrollMarginTop: "calc(var(--nav-h) + 12px)" }}>
          <div className="panel-head">
            <h2>{user.name ? `${user.name}'s library` : "Library"} <span className="muted small">({docs.length})</span></h2>
            <button className="btn sm" onClick={() => { runSync({ quiet: false }); syncInbox({ quiet: false }); }} title="Check for changes from other devices and your inbox">Sync</button>
          </div>
          {docs.length > 4 && <input className="field" type="search" value={libraryQuery} onChange={(e) => setLibraryQuery(e.target.value)} placeholder="Search your library" />}
          {!docs.length && <div className="muted small">Nothing saved yet. Anything you add shows up here with your progress, on every device you sign in on.</div>}
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
                      {!doc.synced && <span title="Not yet saved to your account. It will upload when you're online."> · not synced</span>}
                    </div>
                    <div className="bar"><div style={{ width: `${pct}%` }} /></div>
                  </button>
                  <button aria-label={`Delete ${doc.title}`} className="btn sm ghost" onClick={() => removeDocument(doc)}>✕</button>
                </div>
              );
            })}
            {docs.length > 0 && !filteredDocs.length && <div className="muted small">No matches.</div>}
          </div>
        </section>

        <div className="rest-area">
          <div className="two-col">
            <section className="panel" aria-label="Add">
              <h2>Add</h2>
              <form className="row" onSubmit={(e) => { e.preventDefault(); importUrl(); }}>
                <input className="field" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Article or share link" inputMode="url" autoCapitalize="off" autoCorrect="off" aria-label="Article or share link" />
                <button className="btn primary" type="submit" disabled={busy}>Import</button>
              </form>
              <div className="muted small">Works with web articles and share links from Google Docs, Google Drive, Dropbox and OneDrive.</div>
              <div className="source-buttons">
                <label className="btn">
                  Choose file
                  <input type="file" accept={ACCEPTED_FILES} onChange={(e) => { handleFile(e.target.files?.[0]); e.target.value = ""; }} hidden />
                </label>
                {config?.google && <button className="btn" onClick={pickGoogle} disabled={busy}>Google Drive</button>}
                {config?.dropbox && <button className="btn" onClick={pickDropbox} disabled={busy}>Dropbox</button>}
              </div>
              <div className="muted small">PDF, EPUB, Word, text or HTML. iCloud Drive files are under Choose file → Browse on iPhone and Mac.</div>
              <textarea className="field" value={pasteText} onChange={(e) => setPasteText(e.target.value)} placeholder="Paste text or a link" rows={4} />
              <div className="row">
                <button className="btn primary" onClick={() => savePasted()} disabled={!pasteText.trim() || busy}>Save &amp; read</button>
                {navigator.clipboard?.readText && <button className="btn" onClick={pasteFromClipboard} disabled={busy}>Paste from clipboard</button>}
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
              <div className="muted small">Send things here from your phone or email: <Link to="/account">set it up</Link>.</div>
            </section>
          </div>
        </div>
      </div>

      {focus && (
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


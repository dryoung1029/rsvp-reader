import React, { useEffect, useMemo, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
import Tesseract from "tesseract.js";
import ePub from "epubjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const SAMPLE_TEXT = `Rapid Serial Visual Presentation, or RSVP, shows text one word or short phrase at a time in the same location. Paste text, import a URL, drag in a PDF, or load an EPUB. Start slow, increase gradually, and pause when the material gets dense.`;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function normalizeText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/\[\s*/g, " ")
    .replace(/\s*\]/g, " ")
    .trim();
}

function getWords(value) {
  const clean = normalizeText(value);
  return clean ? clean.split(" ").filter(Boolean) : [];
}

function makeChunks(words, size) {
  const chunks = [];
  for (let i = 0; i < words.length; i += size) chunks.push(words.slice(i, i + size).join(" "));
  return chunks;
}

function delayForChunk(chunk, wpm) {
  const wordCount = chunk.split(" ").filter(Boolean).length || 1;
  let delay = (60000 / wpm) * wordCount;
  const last = chunk.slice(-1);
  if (".!?".includes(last)) delay += 260;
  if (",;:".includes(last)) delay += 120;
  if (chunk.length > 16) delay += 40;
  return Math.max(70, delay);
}

function pivotIndex(word) {
  if (word.length <= 1) return 0;
  if (word.length <= 5) return 1;
  if (word.length <= 9) return 2;
  if (word.length <= 13) return 3;
  return 4;
}

function stripHtml(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return doc.body.textContent || "";
}

async function readPdfText(file, setStatus) {
  setStatus(`Reading PDF: ${file.name}...`);
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const pageTexts = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    setStatus(`Reading PDF page ${pageNumber} of ${pdf.numPages}...`);
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const pageText = content.items.map((item) => item.str).join(" ");
    pageTexts.push(pageText);
  }

  return { text: pageTexts.join(" "), buffer, pageCount: pdf.numPages };
}

async function ocrPdfBuffer(buffer, pageCount, setStatus) {
  const loadingTask = pdfjsLib.getDocument({ data: buffer.slice(0) });
  const pdf = await loadingTask.promise;
  const ocrTexts = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    setStatus(`OCR scanning page ${pageNumber} of ${pageCount || pdf.numPages}... this can take a bit.`);
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1.8 });
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: context, viewport }).promise;

    const result = await Tesseract.recognize(canvas, "eng", {
      logger: (message) => {
        if (message.status === "recognizing text") {
          setStatus(`OCR page ${pageNumber}: ${Math.round((message.progress || 0) * 100)}%`);
        }
      }
    });

    ocrTexts.push(result.data.text || "");
  }

  return ocrTexts.join(" ");
}

async function readPdf(file, setStatus) {
  const { text, buffer, pageCount } = await readPdfText(file, setStatus);
  const clean = normalizeText(text);

  if (clean.split(" ").filter(Boolean).length >= Math.max(40, pageCount * 12)) {
    return clean;
  }

  setStatus("PDF text layer was sparse. Starting OCR fallback...");
  return await ocrPdfBuffer(buffer, pageCount, setStatus);
}

async function readEpub(file, setStatus) {
  setStatus(`Reading EPUB: ${file.name}...`);
  const buffer = await file.arrayBuffer();
  const book = ePub(buffer);
  await book.ready;

  const spineItems = book.spine?.spineItems || [];
  const chapterTexts = [];

  for (let i = 0; i < spineItems.length; i += 1) {
    setStatus(`Reading EPUB chapter ${i + 1} of ${spineItems.length}...`);
    const item = spineItems[i];
    try {
      const doc = await item.load(book.load.bind(book));
      chapterTexts.push(stripHtml(doc.documentElement.outerHTML));
      item.unload();
    } catch (error) {
      console.warn("Could not read EPUB chapter", error);
    }
  }

  book.destroy();
  return chapterTexts.join(" ");
}

async function readPlainFile(file) {
  return await file.text();
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
  const [text, setText] = useState(() => localStorage.getItem("rsvp:text") || SAMPLE_TEXT);
  const [title, setTitle] = useState(() => localStorage.getItem("rsvp:title") || "Sample text");
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState("");
  const [wpm, setWpm] = useState(() => Number(localStorage.getItem("rsvp:wpm")) || 325);
  const [chunkSize, setChunkSize] = useState(() => Number(localStorage.getItem("rsvp:chunkSize")) || 1);
  const [fontSize, setFontSize] = useState(() => Number(localStorage.getItem("rsvp:fontSize")) || 62);
  const [index, setIndex] = useState(() => Number(localStorage.getItem("rsvp:index")) || 0);
  const [playing, setPlaying] = useState(false);
  const [dark, setDark] = useState(() => localStorage.getItem("rsvp:dark") !== "false");
  const [pivot, setPivot] = useState(true);
  const [focusLine, setFocusLine] = useState(() => localStorage.getItem("rsvp:focusLine") === "true");
  const [showText, setShowText] = useState(false);
  const [dragging, setDragging] = useState(false);

  const words = useMemo(() => getWords(text), [text]);
  const chunks = useMemo(() => makeChunks(words, chunkSize), [words, chunkSize]);
  const maxIndex = Math.max(0, chunks.length - 1);
  const current = chunks[index] || "";
  const progress = chunks.length ? Math.round(((index + 1) / chunks.length) * 100) : 0;

  useEffect(() => { localStorage.setItem("rsvp:text", text); }, [text]);
  useEffect(() => { localStorage.setItem("rsvp:title", title); }, [title]);
  useEffect(() => { localStorage.setItem("rsvp:wpm", String(wpm)); }, [wpm]);
  useEffect(() => { localStorage.setItem("rsvp:chunkSize", String(chunkSize)); }, [chunkSize]);
  useEffect(() => { localStorage.setItem("rsvp:fontSize", String(fontSize)); }, [fontSize]);
  useEffect(() => { localStorage.setItem("rsvp:index", String(index)); }, [index]);
  useEffect(() => { localStorage.setItem("rsvp:dark", String(dark)); }, [dark]);
  useEffect(() => { localStorage.setItem("rsvp:focusLine", String(focusLine)); }, [focusLine]);

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

  useEffect(() => {
    function onKeyDown(event) {
      const tag = event.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (event.code === "Space") { event.preventDefault(); setPlaying((p) => !p); }
      if (event.key === "ArrowLeft") setIndex((i) => clamp(i - 1, 0, maxIndex));
      if (event.key === "ArrowRight") setIndex((i) => clamp(i + 1, 0, maxIndex));
      if (event.key === "r" || event.key === "R") { setPlaying(false); setIndex(0); }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [maxIndex]);

  async function setLoadedText(rawText, newTitle) {
    const clean = normalizeText(rawText);
    if (!clean) {
      setStatus("No readable text found. OCR may not have detected text clearly.");
      return;
    }
    setText(clean);
    setTitle(newTitle);
    setIndex(0);
    setPlaying(false);
    setShowText(false);
    setStatus(`Loaded ${clean.split(" ").length.toLocaleString()} words.`);
  }

  async function handleFile(file) {
    if (!file) return;
    setPlaying(false);
    setStatus(`Loading ${file.name}...`);

    try {
      const lower = file.name.toLowerCase();
      const isPdf = lower.endsWith(".pdf") || file.type === "application/pdf";
      const isEpub = lower.endsWith(".epub") || file.type === "application/epub+zip";
      const raw = isPdf ? await readPdf(file, setStatus) : isEpub ? await readEpub(file, setStatus) : await readPlainFile(file);
      await setLoadedText(raw, file.name);
    } catch (error) {
      console.error(error);
      setStatus("Could not read that file. Try PDF, EPUB, TXT, MD, or CSV. If OCR failed, try a clearer scan.");
    }
  }

  async function importUrl() {
    const trimmed = url.trim();
    if (!trimmed) return;
    setStatus("Importing article...");
    setPlaying(false);
    try {
      const response = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: trimmed })
      });
      const data = await response.json();
      const clean = normalizeText(data.text || "");
      if (!response.ok || !clean) throw new Error(data.error || "No readable article text found.");
      setText(clean);
      setTitle(data.title || trimmed);
      setIndex(0);
      setShowText(false);
      setStatus(`Imported ${clean.split(" ").length.toLocaleString()} words.`);
    } catch (error) {
      setStatus("Could not cleanly import that page. Try copying/pasting the article text instead.");
    }
  }

  function loadFile(event) {
    handleFile(event.target.files?.[0]);
    event.target.value = "";
  }

  function onDrop(event) {
    event.preventDefault();
    event.stopPropagation();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    handleFile(file);
  }

  const c = dark ? {
    page: "#020617", text: "#f8fafc", panel: "#0f172a", panel2: "#111827", border: "#334155", muted: "#94a3b8", input: "#020617"
  } : {
    page: "#f8fafc", text: "#0f172a", panel: "#ffffff", panel2: "#e2e8f0", border: "#cbd5e1", muted: "#475569", input: "#ffffff"
  };

  const button = { border: `1px solid ${c.border}`, background: c.panel2, color: c.text, borderRadius: 14, padding: "12px 14px", fontWeight: 800, cursor: "pointer" };
  const primary = { ...button, background: "#ef4444", borderColor: "#ef4444", color: "white", minWidth: 110 };
  const input = { width: "100%", border: `1px solid ${c.border}`, background: c.input, color: c.text, borderRadius: 14, padding: 13, fontSize: 16 };

  return (
    <div style={{ minHeight: "100vh", background: c.page, color: c.text, fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif", padding: "env(safe-area-inset-top) 14px 24px" }}>
      <main style={{ maxWidth: 1040, margin: "0 auto", display: "grid", gap: 16 }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap", paddingTop: 18 }}>
          <div>
            <div style={{ color: c.muted, fontSize: 13, fontWeight: 900, letterSpacing: 1, textTransform: "uppercase" }}>RSVP Reader</div>
            <h1 style={{ margin: "6px 0 4px", fontSize: "clamp(30px, 8vw, 54px)", lineHeight: 0.98 }}>Read faster. Blink responsibly.</h1>
            <div style={{ color: c.muted, lineHeight: 1.45 }}>Drag in PDF, EPUB, TXT, MD, or CSV. Scanned PDFs use OCR automatically when needed.</div>
          </div>
          <button style={button} onClick={() => setDark((d) => !d)}>{dark ? "Light" : "Dark"}</button>
        </header>

        <section
          onDragEnter={(e) => { e.preventDefault(); setDragging(true); }}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={(e) => { e.preventDefault(); setDragging(false); }}
          onDrop={onDrop}
          style={{ background: c.panel, border: `2px dashed ${dragging ? "#ef4444" : c.border}`, borderRadius: 26, padding: 16, boxShadow: "0 20px 50px rgba(0,0,0,.20)", transition: "border-color 120ms ease, transform 120ms ease", transform: dragging ? "scale(1.01)" : "scale(1)" }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", color: c.muted, fontSize: 14, marginBottom: 10 }}>
            <span>{title}</span>
            <span>{words.length.toLocaleString()} words · {progress}%</span>
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
            <button style={button} onClick={() => { setPlaying(false); setIndex(0); }}>Reset</button>
            <button style={button} onClick={() => setIndex((i) => clamp(i - 10, 0, maxIndex))}>-10</button>
            <button style={primary} onClick={() => setPlaying((p) => !p)}>{playing ? "Pause" : "Play"}</button>
            <button style={button} onClick={() => setIndex((i) => clamp(i + 10, 0, maxIndex))}>+10</button>
          </div>
        </section>

        <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(285px, 1fr))", gap: 16 }}>
          <div style={{ background: c.panel, border: `1px solid ${c.border}`, borderRadius: 24, padding: 16, display: "grid", gap: 12 }}>
            <h2 style={{ margin: 0 }}>Import</h2>
            <div style={{ display: "flex", gap: 8 }}>
              <input value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") importUrl(); }} placeholder="Paste article URL" style={input} />
              <button style={primary} onClick={importUrl}>Import</button>
            </div>
            <input type="file" accept=".txt,.md,.csv,.pdf,.epub,application/pdf,application/epub+zip" onChange={loadFile} style={{ color: c.muted }} />
            <div style={{ color: c.muted, fontSize: 14 }}>You can also drag PDF, EPUB, TXT, MD, or CSV directly onto the large reader area.</div>
            {status && <div style={{ color: c.muted, fontSize: 14 }}>{status}</div>}
            <button style={button} onClick={() => setShowText((s) => !s)}>{showText ? "Hide text" : "Show/edit text"}</button>
            {showText && <textarea value={text} onChange={(e) => { setText(e.target.value); setTitle("Edited text"); setIndex(0); }} style={{ ...input, minHeight: 230, lineHeight: 1.5, resize: "vertical" }} />}
          </div>

          <div style={{ background: c.panel, border: `1px solid ${c.border}`, borderRadius: 24, padding: 16, display: "grid", gap: 14 }}>
            <h2 style={{ margin: 0 }}>Controls</h2>
            <label style={{ color: c.muted }}>Speed: {wpm} WPM<input type="range" min="100" max="900" step="25" value={wpm} onChange={(e) => setWpm(Number(e.target.value))} style={{ width: "100%" }} /></label>
            <label style={{ color: c.muted }}>Words per flash: {chunkSize}<input type="range" min="1" max="5" step="1" value={chunkSize} onChange={(e) => { setChunkSize(Number(e.target.value)); setIndex(0); }} style={{ width: "100%" }} /></label>
            <label style={{ color: c.muted }}>Font size: {fontSize}px<input type="range" min="38" max="110" step="2" value={fontSize} onChange={(e) => setFontSize(Number(e.target.value))} style={{ width: "100%" }} /></label>
            <label style={{ color: c.muted }}>Position: {chunks.length ? index + 1 : 0} / {chunks.length}<input type="range" min="0" max={maxIndex} step="1" value={index} onChange={(e) => setIndex(Number(e.target.value))} style={{ width: "100%" }} /></label>
            <label style={{ display: "flex", justifyContent: "space-between", color: c.muted }}>Pivot letter <input type="checkbox" checked={pivot} disabled={chunkSize !== 1} onChange={(e) => setPivot(e.target.checked)} /></label>
            <label style={{ display: "flex", justifyContent: "space-between", color: c.muted }}>Focus line <input type="checkbox" checked={focusLine} onChange={(e) => setFocusLine(e.target.checked)} /></label>
            <div style={{ color: c.muted, border: `1px solid ${c.border}`, borderRadius: 16, padding: 12, background: c.panel2, lineHeight: 1.45 }}>Tip: the focus line aligns with the red pivot letter. OCR is slower because your browser is doing the brainy little monk work locally.</div>
          </div>
        </section>
      </main>
    </div>
  );
}

import { normalizeText, stripHtml, countWords } from "./text.js";

// Joins text segments and records where chapters start, as word offsets into
// the final normalized text: [{ t: title, w: wordIndex }].
function assemble(segments) {
  const parts = [];
  const chapters = [];
  let words = 0;
  for (const seg of segments) {
    const n = countWords(seg.text);
    if (seg.chapter && n > 0) {
      const t = normalizeText(seg.chapter).slice(0, 200);
      if (t && !(chapters.length && chapters[chapters.length - 1].w === words)) chapters.push({ t, w: words });
      else if (t && chapters.length) chapters[chapters.length - 1].t = chapters[chapters.length - 1].t || t;
    }
    if (n > 0) parts.push(seg.text);
    words += n;
  }
  return { text: parts.join(" "), chapters: chapters.length >= 2 ? chapters : [] };
}

// Text containing \u0001N\u0001 markers before each heading, plus the heading titles.
const MARK = /\u0001(\d+)\u0001/;
function fromMarked(marked, titles) {
  const pieces = marked.split(MARK);
  const segments = [{ text: pieces[0] }];
  for (let i = 1; i < pieces.length; i += 2) segments.push({ chapter: titles[Number(pieces[i])], text: pieces[i + 1] || "" });
  return assemble(segments);
}

export function htmlWithChapters(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const headings = Array.from(doc.querySelectorAll("h1, h2"));
  const titles = headings.map((h) => h.textContent || "");
  headings.forEach((h, i) => h.before(doc.createTextNode(` \u0001${i}\u0001 `)));
  return fromMarked(stripHtml(doc.documentElement.outerHTML), titles);
}

function textWithChapters(raw, isMarkdown) {
  const titles = [];
  const heading = isMarkdown ? /^\s{0,3}#{1,2}\s+(.+?)\s*#*\s*$/ : /^\s*((chapter|part|book)\s+([0-9]+|[ivxlcdm]+|[a-z]+)\b.{0,70})$/i;
  const lines = String(raw).split(/\r?\n/).map((line) => {
    const m = line.length < 120 && line.match(heading);
    if (!m) return line;
    titles.push(m[1]);
    return ` \u0001${titles.length - 1}\u0001 ${isMarkdown ? m[1] : line}`;
  });
  return fromMarked(lines.join("\n"), titles);
}

// Heavy libraries are loaded only when a file of that type is opened,
// which keeps the first page load small on phones.
let pdfjsPromise;
async function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = Promise.all([
      import("pdfjs-dist"),
      import("pdfjs-dist/build/pdf.worker.mjs?url")
    ]).then(([pdfjsLib, worker]) => {
      pdfjsLib.GlobalWorkerOptions.workerSrc = worker.default;
      return pdfjsLib;
    });
  }
  return pdfjsPromise;
}

function xmlAttr(node, name) {
  return node?.getAttribute(name) || "";
}

function cleanPath(path) {
  const parts = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

function joinPath(base, href) {
  const decoded = (() => { try { return decodeURIComponent(href); } catch { return href; } })();
  return cleanPath(base ? `${base}/${decoded}` : decoded);
}

// Top two levels of the PDF's bookmarks, as { title, pageIndex }.
async function pdfOutline(pdf) {
  const outline = await pdf.getOutline().catch(() => null);
  if (!outline?.length) return [];
  const flat = [];
  for (const item of outline) {
    flat.push(item);
    if (outline.length < 4) for (const child of item.items || []) flat.push(child);
  }
  const marks = [];
  for (const item of flat.slice(0, 500)) {
    try {
      const dest = typeof item.dest === "string" ? await pdf.getDestination(item.dest) : item.dest;
      if (!Array.isArray(dest) || !dest[0]) continue;
      const pageIndex = typeof dest[0] === "number" ? dest[0] : await pdf.getPageIndex(dest[0]);
      marks.push({ title: item.title || "", pageIndex });
    } catch { /* unresolvable bookmark */ }
  }
  return marks.sort((a, b) => a.pageIndex - b.pageIndex);
}

function pagesWithChapters(pages, marks) {
  const byPage = new Map();
  for (const m of marks) if (!byPage.has(m.pageIndex)) byPage.set(m.pageIndex, m.title);
  return assemble(pages.map((text, i) => ({ text, chapter: byPage.get(i) })));
}

async function readPdfPages(pdf, setStatus) {
  const pages = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    setStatus(`Reading PDF page ${pageNumber} of ${pdf.numPages}...`);
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => item.str).join(" "));
  }
  return pages;
}

async function ocrPdfPages(pdf, setStatus) {
  const { default: Tesseract } = await import("tesseract.js");
  const worker = await Tesseract.createWorker("eng", 1, {
    logger: (message) => {
      if (message.status === "recognizing text") {
        setStatus(`OCR: ${Math.round((message.progress || 0) * 100)}% of current page`);
      }
    }
  });
  const pages = [];
  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      setStatus(`OCR scanning page ${pageNumber} of ${pdf.numPages}... this can take a bit.`);
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1.8 });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
      const result = await worker.recognize(canvas);
      pages.push(result.data.text || "");
      canvas.width = canvas.height = 0;
    }
  } finally {
    await worker.terminate();
  }
  return pages;
}

async function readPdf(buffer, setStatus) {
  const pdfjsLib = await loadPdfjs();
  const pdf = await pdfjsLib.getDocument({ data: buffer.slice(0) }).promise;
  const marks = await pdfOutline(pdf);
  let pages = await readPdfPages(pdf, setStatus);
  if (countWords(pages.join(" ")) < Math.max(40, pdf.numPages * 12)) {
    setStatus("PDF text layer was sparse. Starting OCR fallback...");
    pages = await ocrPdfPages(pdf, setStatus);
  }
  return pagesWithChapters(pages, marks);
}

// Maps each content file to the first table-of-contents label pointing at it.
// Uses the EPUB 3 nav document, or the EPUB 2 NCX file.
async function epubToc(zip, parser, opfDoc, opfBase) {
  const map = new Map();
  const add = (baseDir, href, label) => {
    if (!href || !label) return;
    const path = joinPath(baseDir, href.split("#")[0]);
    if (!map.has(path)) map.set(path, normalizeText(label));
  };
  const dirOf = (path) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
  const items = Array.from(opfDoc.querySelectorAll("manifest item"));
  const navItem = items.find((item) => (xmlAttr(item, "properties") || "").split(/\s+/).includes("nav"));
  if (navItem) {
    const navPath = joinPath(opfBase, xmlAttr(navItem, "href"));
    const html = await zip.file(navPath)?.async("text");
    if (html) {
      const nav = parser.parseFromString(html, "text/html");
      const tocNav = Array.from(nav.querySelectorAll("nav")).find((n) => /toc/.test(n.getAttribute("epub:type") || n.getAttribute("type") || n.id || "")) || nav.querySelector("nav");
      tocNav?.querySelectorAll("a[href]").forEach((a) => add(dirOf(navPath), a.getAttribute("href"), a.textContent));
    }
  }
  if (!map.size) {
    const tocId = xmlAttr(opfDoc.querySelector("spine"), "toc");
    const ncxItem = items.find((item) => xmlAttr(item, "id") === tocId) || items.find((item) => /ncx/.test(xmlAttr(item, "media-type")));
    if (ncxItem) {
      const ncxPath = joinPath(opfBase, xmlAttr(ncxItem, "href"));
      const xml = await zip.file(ncxPath)?.async("text");
      if (xml) {
        const ncx = parser.parseFromString(xml, "application/xml");
        Array.from(ncx.getElementsByTagNameNS("*", "navPoint")).forEach((point) => {
          const label = point.getElementsByTagNameNS("*", "text")[0]?.textContent;
          const src = point.getElementsByTagNameNS("*", "content")[0]?.getAttribute("src");
          add(dirOf(ncxPath), src, label);
        });
      }
    }
  }
  return map;
}

async function readEpub(buffer, setStatus) {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(buffer);
  const parser = new DOMParser();

  const containerEntry = zip.file("META-INF/container.xml");
  if (!containerEntry) throw new Error("Invalid EPUB: missing META-INF/container.xml");
  const containerDoc = parser.parseFromString(await containerEntry.async("text"), "application/xml");
  const rootfilePath = xmlAttr(containerDoc.querySelector("rootfile"), "full-path");
  if (!rootfilePath) throw new Error("Invalid EPUB: missing OPF rootfile path");

  const opfEntry = zip.file(rootfilePath);
  if (!opfEntry) throw new Error(`Invalid EPUB: missing ${rootfilePath}`);
  const opfDoc = parser.parseFromString(await opfEntry.async("text"), "application/xml");
  const opfBase = rootfilePath.includes("/") ? rootfilePath.slice(0, rootfilePath.lastIndexOf("/")) : "";
  const bookTitle = normalizeText(opfDoc.getElementsByTagNameNS("*", "title")[0]?.textContent || "");

  const manifest = new Map();
  opfDoc.querySelectorAll("manifest item").forEach((item) => {
    const id = xmlAttr(item, "id");
    const href = xmlAttr(item, "href");
    if (id && href) manifest.set(id, href);
  });

  let spineIds = Array.from(opfDoc.querySelectorAll("spine itemref")).map((item) => xmlAttr(item, "idref")).filter(Boolean);
  if (!spineIds.length) spineIds = Array.from(manifest.keys());

  const toc = await epubToc(zip, parser, opfDoc, opfBase);
  const segments = [];
  for (let i = 0; i < spineIds.length; i += 1) {
    const href = manifest.get(spineIds[i]);
    if (!href) continue;
    const fullPath = joinPath(opfBase, href.split("#")[0]);
    const entry = zip.file(fullPath);
    if (!entry) continue;
    if (!/\.(x?html?|xml)$/i.test(fullPath)) continue;
    setStatus(`Reading EPUB section ${i + 1} of ${spineIds.length}...`);
    const html = await entry.async("text");
    let chapter = toc.get(fullPath);
    if (!toc.size) chapter = new DOMParser().parseFromString(html, "text/html").querySelector("h1, h2, title")?.textContent || "";
    segments.push({ text: stripHtml(html), chapter });
  }

  const result = assemble(segments);
  if (!normalizeText(result.text)) throw new Error("No readable EPUB text found. It may be DRM-protected.");
  return { ...result, title: bookTitle };
}

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

// Word documents are zip files; the body text is in word/document.xml.
async function readDocx(buffer, setStatus) {
  setStatus("Reading Word document...");
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(buffer);
  const entry = zip.file("word/document.xml");
  if (!entry) throw new Error("That doesn't look like a Word (.docx) file.");
  const parser = new DOMParser();
  const doc = parser.parseFromString(await entry.async("text"), "application/xml");
  const segments = [];
  for (const p of Array.from(doc.getElementsByTagNameNS(W_NS, "p"))) {
    const style = p.getElementsByTagNameNS(W_NS, "pStyle")[0]?.getAttributeNS(W_NS, "val") || p.getElementsByTagNameNS(W_NS, "pStyle")[0]?.getAttribute("w:val") || "";
    const isHeading = /^(title|heading ?[12])$/i.test(style);
    let line = "";
    const walker = doc.createTreeWalker(p, NodeFilter.SHOW_ELEMENT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.namespaceURI !== W_NS) continue;
      if (node.localName === "t") line += node.textContent;
      else if (node.localName === "tab" || node.localName === "br") line += " ";
    }
    if (line.trim()) segments.push({ text: line, chapter: isHeading ? line : undefined });
  }
  let title = "";
  const core = zip.file("docProps/core.xml");
  if (core) title = normalizeText(parser.parseFromString(await core.async("text"), "application/xml").getElementsByTagNameNS("*", "title")[0]?.textContent || "");
  return { ...assemble(segments), title };
}

function fileKind(name, type) {
  const lower = String(name || "").toLowerCase();
  if (lower.endsWith(".pdf") || type === "application/pdf") return "pdf";
  if (lower.endsWith(".epub") || type === "application/epub+zip") return "epub";
  if (lower.endsWith(".docx") || type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return "docx";
  if (/\.html?$/.test(lower) || type === "text/html") return "html";
  return "text";
}

export const ACCEPTED_FILES = ".txt,.md,.csv,.html,.htm,.pdf,.epub,.docx,text/plain,text/markdown,text/html,application/pdf,application/epub+zip,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

// Accepts a File or Blob (with optional name) and returns { text, title, chapters }.
export async function readDocumentFile(file, setStatus, name = file.name) {
  setStatus(`Reading ${name || "file"}...`);
  const kind = fileKind(name, file.type);
  const lower = String(name || "").toLowerCase();
  const baseTitle = String(name || "Shared file").replace(/\.[a-z0-9]+$/i, "");
  if (kind === "pdf") return { ...(await readPdf(await file.arrayBuffer(), setStatus)), title: baseTitle };
  if (kind === "epub") {
    const result = await readEpub(await file.arrayBuffer(), setStatus);
    return { ...result, title: result.title || baseTitle };
  }
  if (kind === "docx") {
    const result = await readDocx(await file.arrayBuffer(), setStatus);
    if (!normalizeText(result.text)) throw new Error("No text found in that Word document.");
    return { ...result, title: result.title || baseTitle };
  }
  if (kind === "html") return { ...htmlWithChapters(await file.text()), title: baseTitle };
  return { ...textWithChapters(await file.text(), /\.(md|markdown)$/.test(lower) || file.type === "text/markdown"), title: baseTitle };
}

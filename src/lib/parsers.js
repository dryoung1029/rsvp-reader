import { normalizeText, stripHtml } from "./text.js";

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

async function readPdfText(buffer, setStatus) {
  const pdfjsLib = await loadPdfjs();
  const pdf = await pdfjsLib.getDocument({ data: buffer.slice(0) }).promise;
  const pageTexts = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    setStatus(`Reading PDF page ${pageNumber} of ${pdf.numPages}...`);
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    pageTexts.push(content.items.map((item) => item.str).join(" "));
  }
  return { text: pageTexts.join(" "), pageCount: pdf.numPages };
}

async function ocrPdfBuffer(buffer, setStatus) {
  const [pdfjsLib, { default: Tesseract }] = await Promise.all([loadPdfjs(), import("tesseract.js")]);
  const pdf = await pdfjsLib.getDocument({ data: buffer.slice(0) }).promise;
  const worker = await Tesseract.createWorker("eng", 1, {
    logger: (message) => {
      if (message.status === "recognizing text") {
        setStatus(`OCR: ${Math.round((message.progress || 0) * 100)}% of current page`);
      }
    }
  });
  const ocrTexts = [];
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
      ocrTexts.push(result.data.text || "");
      canvas.width = canvas.height = 0;
    }
  } finally {
    await worker.terminate();
  }
  return ocrTexts.join(" ");
}

async function readPdf(buffer, setStatus) {
  const { text, pageCount } = await readPdfText(buffer, setStatus);
  const clean = normalizeText(text);
  if (clean.split(" ").filter(Boolean).length >= Math.max(40, pageCount * 12)) return clean;
  setStatus("PDF text layer was sparse. Starting OCR fallback...");
  return await ocrPdfBuffer(buffer, setStatus);
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

  const texts = [];
  for (let i = 0; i < spineIds.length; i += 1) {
    const href = manifest.get(spineIds[i]);
    if (!href) continue;
    const fullPath = joinPath(opfBase, href.split("#")[0]);
    const entry = zip.file(fullPath);
    if (!entry) continue;
    if (!/\.(x?html?|xml)$/i.test(fullPath)) continue;
    setStatus(`Reading EPUB section ${i + 1} of ${spineIds.length}...`);
    texts.push(stripHtml(await entry.async("text")));
  }

  const joined = texts.join(" ");
  if (!normalizeText(joined)) throw new Error("No readable EPUB text found. It may be DRM-protected.");
  return { text: joined, title: bookTitle };
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
  const paragraphs = [];
  for (const p of Array.from(doc.getElementsByTagNameNS(W_NS, "p"))) {
    let line = "";
    const walker = doc.createTreeWalker(p, NodeFilter.SHOW_ELEMENT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.namespaceURI !== W_NS) continue;
      if (node.localName === "t") line += node.textContent;
      else if (node.localName === "tab" || node.localName === "br") line += " ";
    }
    if (line.trim()) paragraphs.push(line);
  }
  let title = "";
  const core = zip.file("docProps/core.xml");
  if (core) title = normalizeText(parser.parseFromString(await core.async("text"), "application/xml").getElementsByTagNameNS("*", "title")[0]?.textContent || "");
  return { text: paragraphs.join(" "), title };
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

// Accepts a File or Blob (with optional name) and returns { text, title }.
export async function readDocumentFile(file, setStatus, name = file.name) {
  setStatus(`Reading ${name || "file"}...`);
  const kind = fileKind(name, file.type);
  const baseTitle = String(name || "Shared file").replace(/\.[a-z0-9]+$/i, "");
  if (kind === "pdf") return { text: await readPdf(await file.arrayBuffer(), setStatus), title: baseTitle };
  if (kind === "epub") {
    const result = await readEpub(await file.arrayBuffer(), setStatus);
    return { text: result.text, title: result.title || baseTitle };
  }
  if (kind === "docx") {
    const result = await readDocx(await file.arrayBuffer(), setStatus);
    if (!normalizeText(result.text)) throw new Error("No text found in that Word document.");
    return { text: result.text, title: result.title || baseTitle };
  }
  if (kind === "html") return { text: stripHtml(await file.text()), title: baseTitle };
  return { text: await file.text(), title: baseTitle };
}

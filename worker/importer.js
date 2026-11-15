// Imports a link: web articles are reduced to their text with Readability;
// share links from Google Docs/Drive, Dropbox and OneDrive are turned into
// direct downloads and the file is passed back for the browser to read.
import { parseHTML } from "linkedom";
import { Readability } from "@mozilla/readability";
import { HttpError, json, readJson, base64url } from "./util.js";
import { requireUser } from "./auth.js";

const MAX_PAGE_BYTES = 5 * 1024 * 1024;
const MAX_FILE_BYTES = 30 * 1024 * 1024;

function isBlockedHost(hostname) {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) return true;
  const v4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  if (host.includes(":")) return host === "::" || host === "::1" || /^(fc|fd|fe80)/.test(host) || host.startsWith("::ffff:");
  return false;
}

// Rewrites cloud "share" links into something that downloads the content.
export function resolveShareLink(rawUrl) {
  const url = new URL(rawUrl);
  const host = url.hostname.toLowerCase();

  const gdoc = url.pathname.match(/^\/document\/(?:u\/\d+\/)?d\/([\w-]+)/);
  if (host === "docs.google.com" && gdoc) {
    return { url: `https://docs.google.com/document/d/${gdoc[1]}/export?format=txt`, provider: "Google Docs", forceText: true };
  }
  const gslides = url.pathname.match(/^\/presentation\/d\/([\w-]+)/);
  if (host === "docs.google.com" && gslides) {
    return { url: `https://docs.google.com/presentation/d/${gslides[1]}/export/txt`, provider: "Google Slides", forceText: true };
  }
  const gfile = url.pathname.match(/^\/file\/d\/([\w-]+)/);
  if (host === "drive.google.com" && (gfile || url.searchParams.get("id"))) {
    const id = gfile ? gfile[1] : url.searchParams.get("id");
    return { url: `https://drive.usercontent.google.com/download?id=${encodeURIComponent(id)}&export=download&confirm=t`, provider: "Google Drive" };
  }
  if (host === "www.dropbox.com" || host === "dropbox.com") {
    url.searchParams.delete("dl");
    url.searchParams.set("raw", "1");
    return { url: url.toString(), provider: "Dropbox" };
  }
  if (host === "1drv.ms" || host.endsWith("onedrive.live.com") || host.endsWith("sharepoint.com")) {
    const encoded = `u!${base64url(new TextEncoder().encode(rawUrl))}`;
    return { url: `https://api.onedrive.com/v1.0/shares/${encoded}/root/content`, provider: "OneDrive" };
  }
  return { url: url.toString(), provider: "" };
}

export function htmlToText(html) {
  if (!html) return "";
  const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
  document.querySelectorAll("script, style, noscript").forEach((el) => el.remove());
  document.querySelectorAll("p, div, br, li, tr, h1, h2, h3, h4, h5, h6, blockquote").forEach((el) => el.append(" "));
  return document.body?.textContent || "";
}

function htmlToArticle(html, url) {
  const { document } = parseHTML(html);
  const pageTitle = document.querySelector("title")?.textContent?.trim() || "";
  let article = null;
  try { article = new Readability(document).parse(); } catch (error) { console.warn("readability failed", error.message); }
  return { title: article?.title || pageTitle || url, text: article?.textContent || htmlToText(html) };
}

function filenameFrom(response, url) {
  const disposition = response.headers.get("content-disposition") || "";
  const star = disposition.match(/filename\*=(?:UTF-8'')?([^;]+)/i);
  if (star) { try { return decodeURIComponent(star[1].replace(/"/g, "")); } catch { /* fall through */ } }
  const plain = disposition.match(/filename="?([^";]+)"?/i);
  if (plain) return plain[1];
  const last = new URL(url).pathname.split("/").filter(Boolean).pop() || "document";
  try { return decodeURIComponent(last); } catch { return last; }
}

async function handleImport(request, env) {
  await requireUser(request, env);
  const body = await readJson(request);
  let target;
  try { target = new URL(String(body.url || "").trim()); } catch { throw new HttpError(400, "Please provide a valid link."); }
  if (!/^https?:$/.test(target.protocol) || isBlockedHost(target.hostname)) throw new HttpError(400, "That address can't be imported.");

  const resolved = resolveShareLink(target.toString());
  const response = await fetch(resolved.url, {
    redirect: "follow",
    signal: AbortSignal.timeout(20000),
    headers: { "user-agent": "Mozilla/5.0 (compatible; RAFAS reader; +https://rafas.app/about)", accept: "text/html,application/xhtml+xml,application/pdf,application/epub+zip,*/*;q=0.8" }
  });
  if (isBlockedHost(new URL(response.url || resolved.url).hostname)) throw new HttpError(400, "That address can't be imported.");
  if (!response.ok) {
    const hint = resolved.provider ? ` Make sure the ${resolved.provider} file is shared so anyone with the link can view it.` : "";
    throw new HttpError(502, `The site didn't allow the import (${response.status}).${hint}`);
  }

  const type = (response.headers.get("content-type") || "").toLowerCase();
  const length = Number(response.headers.get("content-length") || 0);

  if (resolved.forceText || type.startsWith("text/plain")) {
    const text = await response.text();
    if (resolved.provider && /^\s*<!doctype html/i.test(text)) throw new HttpError(403, `That ${resolved.provider} file isn't shared publicly. Set it to "Anyone with the link".`);
    return json({ kind: "article", title: body.title || "", text: text.slice(0, MAX_PAGE_BYTES), provider: resolved.provider });
  }

  if (type.includes("text/html") || type.includes("application/xhtml")) {
    if (resolved.provider) throw new HttpError(403, `That ${resolved.provider} file isn't shared publicly, or it's too large to download directly. Set it to "Anyone with the link", or download it and use Choose file.`);
    if (length > MAX_PAGE_BYTES) throw new HttpError(413, "That page is too large to import.");
    const html = await response.text();
    if (html.length > MAX_PAGE_BYTES) throw new HttpError(413, "That page is too large to import.");
    return json({ kind: "article", ...htmlToArticle(html, response.url || resolved.url) });
  }

  // Anything else is a file (PDF, EPUB, DOCX…): stream it back to the browser to parse.
  if (length > MAX_FILE_BYTES) throw new HttpError(413, "That file is too large to import (30 MB limit).");
  return new Response(response.body, {
    headers: {
      "content-type": type || "application/octet-stream",
      "x-rafas-kind": "file",
      "x-rafas-filename": encodeURIComponent(filenameFrom(response, response.url || resolved.url)),
      "cache-control": "no-store"
    }
  });
}

export async function handleImporter(request, env, pathname) {
  if ((pathname === "/api/import" || pathname === "/api/extract") && request.method === "POST") return handleImport(request, env);
  return null;
}

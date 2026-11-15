// RAFAS Cloudflare Worker.
// Static files are served by Workers Assets; this Worker only handles /api/*,
// the /share fallback, and mail arriving through Cloudflare Email Routing.
import { parseHTML } from "linkedom";
import { Readability } from "@mozilla/readability";
import PostalMime from "postal-mime";

const MAX_PAGE_BYTES = 5 * 1024 * 1024;
const MAX_ITEM_BYTES = 24 * 1024 * 1024; // KV values max out at 25 MiB
const ITEM_TTL_SECONDS = 60 * 60 * 24 * 30; // unclaimed inbox items expire after 30 days

const READABLE_FILE = /\.(pdf|epub|txt|md|markdown|csv|html?)$/i;
const READABLE_TYPE = /^(application\/pdf|application\/epub\+zip|text\/)/i;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// ---------- Article extraction ----------

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

async function fetchPage(rawUrl) {
  let url;
  try { url = new URL(rawUrl); } catch { throw new HttpError(400, "Please provide a valid http or https URL."); }
  if (!/^https?:$/.test(url.protocol) || isBlockedHost(url.hostname)) throw new HttpError(400, "That address can't be imported.");

  const response = await fetch(url.toString(), {
    redirect: "follow",
    signal: AbortSignal.timeout(15000),
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; RAFAS reader; +https://rafas.app/about)",
      accept: "text/html,application/xhtml+xml"
    }
  });
  if (!response.ok) throw new HttpError(502, "The site did not allow the article to be fetched.");
  if (isBlockedHost(new URL(response.url || url).hostname)) throw new HttpError(400, "That address can't be imported.");
  if (Number(response.headers.get("content-length") || 0) > MAX_PAGE_BYTES) throw new HttpError(413, "That page is too large to import.");
  const html = await response.text();
  if (html.length > MAX_PAGE_BYTES) throw new HttpError(413, "That page is too large to import.");
  return { html, finalUrl: response.url || url.toString() };
}

function htmlToArticle(html, url) {
  const { document } = parseHTML(html);
  const pageTitle = document.querySelector("title")?.textContent?.trim() || "";
  let article = null;
  try { article = new Readability(document).parse(); } catch (error) { console.warn("readability failed", error.message); }
  const text = article?.textContent || htmlToText(html);
  return { title: article?.title || pageTitle || url, byline: article?.byline || "", text };
}

function htmlToText(html) {
  if (!html) return "";
  const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
  document.querySelectorAll("script, style, noscript").forEach((el) => el.remove());
  document.querySelectorAll("p, div, br, li, tr, h1, h2, h3, h4, h5, h6, blockquote").forEach((el) => el.append(" "));
  return document.body?.textContent || "";
}

async function handleExtract(request) {
  const body = await request.json().catch(() => ({}));
  if (!body.url || !/^https?:\/\//i.test(body.url)) throw new HttpError(400, "Please provide a valid http or https URL.");
  const { html, finalUrl } = await fetchPage(body.url);
  return json(htmlToArticle(html, finalUrl));
}

// ---------- Inbox (KV) ----------
// Each item is one KV entry: the value holds the file bytes (or JSON {text, url}),
// and the small metadata object is what the list endpoint returns.

function cleanSubject(subject) {
  return String(subject || "").replace(/^\s*((re|fw|fwd)\s*:\s*)+/i, "").trim();
}

function firstUrl(text) {
  const match = String(text || "").match(/https?:\/\/[^\s<>"')\]]+/i);
  return match ? match[0] : "";
}

function wordCount(text) {
  return String(text || "").trim().split(/\s+/).filter(Boolean).length;
}

function isReadableAttachment(name, type) {
  return READABLE_FILE.test(name || "") || READABLE_TYPE.test(type || "");
}

// Normalises a share, form post, or email into inbox items.
function buildItems({ title, text, html, url, files }) {
  const subject = cleanSubject(title);
  const items = [];
  for (const file of files || []) {
    if (!isReadableAttachment(file.name, file.type)) continue;
    items.push({ kind: "file", title: subject, name: file.name || "document", type: file.type || "", data: file.data });
  }
  if (items.length) return items;

  let body = String(text || "").trim();
  if (!body && html) body = htmlToText(html).trim();
  const link = String(url || "").trim();
  if (link) return [{ kind: "url", title: subject, url: link, text: body }];
  if (!body) return [];

  // A short message that is basically a link means "read this article".
  const found = firstUrl(body);
  if (found && wordCount(body) <= 40) return [{ kind: "url", title: subject, url: found, text: body }];
  return [{ kind: "text", title: subject || body.split(/\s+/).slice(0, 8).join(" "), text: body }];
}

function clip(value, max) {
  const s = String(value || "");
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

async function saveItems(env, items) {
  const saved = [];
  for (const item of items) {
    const id = crypto.randomUUID();
    const value = item.kind === "file" ? item.data : JSON.stringify({ text: item.text || "", url: item.url || "" });
    const size = typeof value === "string" ? value.length : value.byteLength;
    if (size > MAX_ITEM_BYTES) throw new HttpError(413, `${item.name || "Item"} is too large (limit 24 MB).`);
    const metadata = {
      kind: item.kind,
      title: clip(item.title, 200),
      name: clip(item.name, 120),
      type: clip(item.type, 80),
      url: clip(item.url, 300),
      receivedAt: Date.now(),
      size
    };
    await env.INBOX.put(`item:${id}`, value, { metadata, expirationTtl: ITEM_TTL_SECONDS });
    saved.push({ id, ...metadata });
  }
  return saved;
}

function timingSafeEqual(a, b) {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i += 1) diff |= x[i] ^ y[i];
  return diff === 0;
}

function readToken(request) {
  const header = request.headers.get("authorization") || "";
  if (/^bearer\s+/i.test(header)) return header.replace(/^bearer\s+/i, "").trim();
  if (/^basic\s+/i.test(header)) {
    try {
      const decoded = atob(header.replace(/^basic\s+/i, ""));
      return decoded.slice(decoded.indexOf(":") + 1);
    } catch { return ""; }
  }
  return request.headers.get("x-inbox-token") || new URL(request.url).searchParams.get("token") || "";
}

function requireInbox(request, env) {
  if (!env.INBOX_TOKEN || !env.INBOX) throw new HttpError(503, "The inbox is not set up yet. See the README for INBOX_TOKEN.");
  if (!timingSafeEqual(readToken(request), env.INBOX_TOKEN)) throw new HttpError(401, "Invalid inbox token.");
}

async function handleInboxPost(request, env) {
  const type = request.headers.get("content-type") || "";
  let fields = {};
  const files = [];
  if (type.includes("application/json")) {
    fields = await request.json().catch(() => ({}));
  } else if (type.includes("multipart/form-data") || type.includes("application/x-www-form-urlencoded")) {
    const form = await request.formData();
    for (const [key, value] of form.entries()) {
      if (typeof value === "string") fields[key] = value;
      else if (value && value.size) files.push({ name: value.name, type: value.type, data: await value.arrayBuffer() });
    }
  } else {
    // Raw body: treat as plain text (handy for `curl --data-binary @notes.txt`).
    fields = { text: await request.text(), title: new URL(request.url).searchParams.get("title") || "" };
  }
  const items = buildItems({ title: fields.title || fields.subject, text: fields.text, html: fields.html, url: fields.url, files });
  if (!items.length) throw new HttpError(400, "Nothing readable was sent. Include text, a url, or a PDF/EPUB/TXT file.");
  const saved = await saveItems(env, items);
  return json({ ok: true, items: saved.map(({ id, kind, title, name }) => ({ id, kind, title, name })) }, 201);
}

async function handleInboxList(env) {
  const items = [];
  let cursor;
  do {
    const page = await env.INBOX.list({ prefix: "item:", cursor });
    for (const key of page.keys) items.push({ id: key.name.slice(5), ...(key.metadata || {}) });
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  items.sort((a, b) => (a.receivedAt || 0) - (b.receivedAt || 0));
  return json({ items });
}

async function handleInboxGet(env, id) {
  const { value, metadata } = await env.INBOX.getWithMetadata(`item:${id}`, { type: "arrayBuffer" });
  if (!value) throw new HttpError(404, "Not found");
  const contentType = metadata?.kind === "file" ? (metadata.type || "application/octet-stream") : "application/json";
  return new Response(value, { headers: { "content-type": contentType, "cache-control": "no-store" } });
}

// ---------- Router ----------

async function handleApi(request, env, url) {
  const { pathname } = url;
  const method = request.method;

  if (pathname === "/api/status") return json({ inbox: Boolean(env.INBOX_TOKEN && env.INBOX), email: env.INBOX_EMAIL || "" });
  if (pathname === "/api/extract" && method === "POST") return handleExtract(request);

  if (pathname === "/api/inbox") {
    requireInbox(request, env);
    if (method === "POST") return handleInboxPost(request, env);
    if (method === "GET") return handleInboxList(env);
  }

  const match = pathname.match(/^\/api\/inbox\/([0-9a-f-]{36})$/);
  if (match) {
    requireInbox(request, env);
    if (method === "GET") return handleInboxGet(env, match[1]);
    if (method === "DELETE") { await env.INBOX.delete(`item:${match[1]}`); return json({ ok: true }); }
  }

  throw new HttpError(404, "Not found");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      try {
        return await handleApi(request, env, url);
      } catch (error) {
        if (!(error instanceof HttpError)) console.error(error);
        const status = error instanceof HttpError ? error.status : (error.name === "TimeoutError" ? 504 : 500);
        return json({ error: error instanceof HttpError ? error.message : status === 504 ? "The site took too long to respond." : "Something went wrong." }, status);
      }
    }
    // The installed app's service worker normally catches share-sheet posts.
    // If it hasn't installed yet, land on the app instead of an error page.
    if (url.pathname === "/share" && request.method === "POST") {
      return Response.redirect(new URL("/?shared=1", url).toString(), 303);
    }
    return env.ASSETS.fetch(request);
  },

  // Cloudflare Email Routing delivers mail for the configured address here.
  async email(message, env) {
    const allowed = String(env.ALLOWED_SENDERS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    const parsed = await PostalMime.parse(message.raw);
    const senders = [message.from, parsed.from?.address].filter(Boolean).map((s) => s.toLowerCase());
    if (!allowed.length || !senders.some((s) => allowed.includes(s))) {
      message.setReject("This address only accepts mail from approved senders.");
      return;
    }
    const items = buildItems({
      title: parsed.subject,
      text: parsed.text,
      html: parsed.html,
      files: (parsed.attachments || []).map((a) => ({
        name: a.filename || "",
        type: a.mimeType || "",
        data: typeof a.content === "string" ? new TextEncoder().encode(a.content).buffer : a.content
      }))
    });
    if (!items.length) {
      message.setReject("No readable text, link, or PDF/EPUB/TXT attachment found.");
      return;
    }
    await saveItems(env, items);
  }
};

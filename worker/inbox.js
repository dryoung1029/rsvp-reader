// Per-user inbox for items sent from the iPhone Shortcut, scripts or email.
// Items live in KV under item:<userId>:<itemId> until a signed-in device imports them.
import { HttpError, json, sha256 } from "./util.js";
import { requireUser } from "./auth.js";
import { htmlToText } from "./importer.js";

const MAX_ITEM_BYTES = 24 * 1024 * 1024;
const ITEM_TTL_SECONDS = 60 * 60 * 24 * 30;
const READABLE_FILE = /\.(pdf|epub|docx|txt|md|markdown|csv|html?)$/i;
const READABLE_TYPE = /^(application\/pdf|application\/epub\+zip|application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document|text\/)/i;

function cleanSubject(subject) {
  return String(subject || "").replace(/^\s*((re|fw|fwd)\s*:\s*)+/i, "").trim();
}

function firstUrl(text) {
  const match = String(text || "").match(/https?:\/\/[^\s<>"')\]]+/i);
  return match ? match[0] : "";
}

function clip(value, max) {
  const s = String(value || "");
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export function isReadableAttachment(name, type) {
  return READABLE_FILE.test(name || "") || READABLE_TYPE.test(type || "");
}

// Normalises a share, form post, or email into inbox items.
export function buildItems({ title, text, html, url, files }) {
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
  if (found && body.split(/\s+/).length <= 40) return [{ kind: "url", title: subject, url: found, text: body }];
  return [{ kind: "text", title: subject || body.split(/\s+/).slice(0, 8).join(" "), text: body }];
}

export async function saveItems(env, userId, items) {
  const saved = [];
  for (const item of items) {
    const id = crypto.randomUUID();
    const value = item.kind === "file" ? item.data : JSON.stringify({ text: item.text || "", url: item.url || "" });
    const size = typeof value === "string" ? value.length : value.byteLength;
    if (size > MAX_ITEM_BYTES) throw new HttpError(413, `${item.name || "Item"} is too large (limit 24 MB).`);
    const metadata = { kind: item.kind, title: clip(item.title, 200), name: clip(item.name, 120), type: clip(item.type, 80), receivedAt: Date.now(), size };
    await env.INBOX.put(`item:${userId}:${id}`, value, { metadata, expirationTtl: ITEM_TTL_SECONDS });
    saved.push({ id, ...metadata });
  }
  return saved;
}

// The Shortcut authenticates with a personal token instead of a cookie.
// Accepts "Bearer <token>", a bare token, Basic auth, an x-inbox-token header or ?token=.
function tokenFrom(request) {
  const header = (request.headers.get("authorization") || "").trim();
  let token = "";
  if (/^bearer\s+/i.test(header)) token = header.replace(/^bearer\s+/i, "").trim();
  else if (/^basic\s+/i.test(header)) {
    try { const d = atob(header.replace(/^basic\s+/i, "")); token = d.slice(d.indexOf(":") + 1); } catch { /* ignore */ }
  } else if (/^rafas_\S+$/.test(header)) token = header;
  return token || (request.headers.get("x-inbox-token") || "").trim() || new URL(request.url).searchParams.get("token") || "";
}

async function userFromToken(env, token) {
  const user = await env.DB.prepare("SELECT * FROM users WHERE inbox_token_hash = ?").bind(await sha256(token)).first();
  if (!user) throw new HttpError(401, "RAFAS didn't recognise this Shortcut's token. Open rafas.app → Account → Set up the Share button, and paste the token into the Shortcut again.");
  return user;
}

// Shortcuts' "File" request body sends the file's bytes as the whole body.
const MAGIC_TYPES = [
  { test: (b) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46, type: "application/pdf", ext: "pdf" },
  { test: (b) => b[0] === 0x50 && b[1] === 0x4b && new TextDecoder().decode(b.subarray(30, 58)).includes("epub"), type: "application/epub+zip", ext: "epub" },
  { test: (b) => b[0] === 0x50 && b[1] === 0x4b, type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ext: "docx" }
];
const EXT_FOR_TYPE = { "application/pdf": "pdf", "application/epub+zip": "epub", "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx", "text/html": "html", "text/markdown": "md" };

function filenameFrom(request) {
  const disposition = request.headers.get("content-disposition") || "";
  const m = disposition.match(/filename\*=UTF-8''([^;]+)/i) || disposition.match(/filename="?([^";]+)"?/i);
  let name = m ? m[1] : (request.headers.get("x-filename") || new URL(request.url).searchParams.get("name") || "");
  try { name = decodeURIComponent(name); } catch { /* keep as is */ }
  return name.trim();
}

function rawBodyFields(request, buffer) {
  const type = (request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  const bytes = new Uint8Array(buffer);
  const params = new URL(request.url).searchParams;
  const title = params.get("title") || "";
  const sniffed = MAGIC_TYPES.find((m) => bytes.length > 4 && m.test(bytes));
  if (!sniffed && (!type || type.startsWith("text/plain") || type === "application/x-www-form-urlencoded")) {
    return { fields: { text: new TextDecoder().decode(bytes), title }, files: [] };
  }
  const fileType = sniffed?.type || type;
  let name = filenameFrom(request);
  const ext = sniffed?.ext || EXT_FOR_TYPE[fileType] || (fileType.startsWith("text/") ? "txt" : "");
  if (!name) name = `document${ext ? `.${ext}` : ""}`;
  else if (ext && !/\.[a-z0-9]{2,8}$/i.test(name)) name = `${name}.${ext}`;
  return { fields: { title }, files: [{ name, type: fileType, data: buffer }] };
}

async function readPost(request) {
  const type = request.headers.get("content-type") || "";
  let fields = {};
  let rawFiles;
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
    ({ fields, files: rawFiles } = rawBodyFields(request, await request.arrayBuffer()));
    files.push(...rawFiles);
  }
  return buildItems({ title: fields.title || fields.subject, text: fields.text, html: fields.html, url: fields.url, files });
}

export async function handleInbox(request, env, pathname) {
  if (!pathname.startsWith("/api/inbox")) return null;
  if (!env.INBOX) throw new HttpError(503, "The inbox isn't set up on this server.");
  const method = request.method;

  if (pathname === "/api/inbox" && method === "POST") {
    const token = tokenFrom(request);
    if (!token) {
      const user = await requireUser(request, env);
      const items = await readPost(request);
      if (!items.length) throw new HttpError(400, "Nothing readable was sent. Include text, a link, or a PDF/EPUB/DOCX/TXT file.");
      const saved = await saveItems(env, user.id, items);
      return json({ ok: true, items: saved.map(({ id, kind, title, name }) => ({ id, kind, title, name })) }, 201);
    }
    // Token requests come from Shortcuts and scripts. Answer in plain text so a
    // Shortcut's notification can show exactly what happened, errors included.
    try {
      const user = await userFromToken(env, token);
      const items = await readPost(request);
      if (!items.length) throw new HttpError(400, "Nothing readable was sent. Share a link, text, or a PDF/EPUB/DOCX/TXT file.");
      const saved = await saveItems(env, user.id, items);
      const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return "link"; } };
      const label = saved.map((i, n) => i.title || i.name || (i.kind === "url" ? `a link from ${host(items[n].url)}` : "text")).join(", ");
      return new Response(`Added to RAFAS: ${clip(label, 120)}. It will be in your library next time you open RAFAS.`, {
        status: 201, headers: { "content-type": "text/plain; charset=utf-8" }
      });
    } catch (error) {
      if (!(error instanceof HttpError)) console.error(error);
      const status = error instanceof HttpError ? error.status : 500;
      const message = error instanceof HttpError ? error.message : "Something went wrong on the server.";
      return new Response(`Not sent to RAFAS. ${message}`, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
    }
  }

  const user = await requireUser(request, env);
  const prefix = `item:${user.id}:`;

  if (pathname === "/api/inbox" && method === "GET") {
    const items = [];
    let cursor;
    do {
      const page = await env.INBOX.list({ prefix, cursor });
      for (const key of page.keys) items.push({ id: key.name.slice(prefix.length), ...(key.metadata || {}) });
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
    items.sort((a, b) => (a.receivedAt || 0) - (b.receivedAt || 0));
    return json({ items });
  }

  const match = pathname.match(/^\/api\/inbox\/([0-9a-f-]{36})$/);
  if (match) {
    const key = `${prefix}${match[1]}`;
    if (method === "GET") {
      const { value, metadata } = await env.INBOX.getWithMetadata(key, { type: "arrayBuffer" });
      if (!value) throw new HttpError(404, "Not found");
      const contentType = metadata?.kind === "file" ? (metadata.type || "application/octet-stream") : "application/json";
      return new Response(value, { headers: { "content-type": contentType, "cache-control": "no-store" } });
    }
    if (method === "DELETE") {
      await env.INBOX.delete(key);
      return json({ ok: true });
    }
  }
  throw new HttpError(404, "Not found");
}
